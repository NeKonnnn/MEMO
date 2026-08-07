"""
Агент для работы с документами (KB + библиотека памяти).
Global documents store больше не используется.
"""

from typing import Any, Dict, List, Optional, Tuple

from backend.app_state import get_rag_chat_top_k
from backend.rag_query.context_budget import rag_context_max_chars
from backend.rag_query.post_generation import maybe_replace_ungrounded
from backend.rag_query.prompts import (
    RAG_STRICT_NOT_FOUND_MESSAGE,
    merge_strict_rag_system_prompt,
)
from backend.rag_query.relevance import hits_to_relevance_percents
from backend.realtime.rag_evidence import (
    RAG_NO_RELEVANT_CONTEXT_MESSAGE,
    build_rag_id_to_filename,
    filter_rag_hits_by_score,
    rag_document_label,
)
from backend.services.memory_rag_env import (
    get_memory_similarity_threshold,
    get_memory_system_prompt,
)
from backend.services.user_rag_settings import (
    runtime_rag_system_prompt,
    runtime_rag_similarity_threshold,
)
from backend.settings.logging import get_logger

from .base_agent import BaseAgent

logger = get_logger(__name__)

Hit = Tuple[str, float, Optional[int], Optional[int]]

class DocumentAgent(BaseAgent):
    """Агент для поиска по KB и библиотеке памяти (не global store)."""

    def __init__(self):
        super().__init__(
            name="document", description="Агент для поиска и анализа документов"
        )
        self.capabilities = ["document_search", "text_analysis", "content_extraction"]

    async def process_message(
        self, message: str, context: Dict[str, Any] = None
    ) -> str:
        """Обработка запросов по документам"""
        try:
            request_strategy = (
                str((context or {}).get("rag_strategy") or "").strip().lower()
            )
            try:
                import backend.main as main_module

                rag_client = getattr(main_module, "rag_client", None)
                current_rag_strategy = request_strategy or getattr(
                    main_module, "current_rag_strategy", "auto"
                )
            except Exception:
                logger.exception("Ошибка операции")
                rag_client = None
                current_rag_strategy = request_strategy or "auto"
            if not rag_client:
                return "Сервис поиска по документам (SVC-RAG) недоступен. Пожалуйста, убедитесь, что система инициализирована."

            logger.info("[DocumentAgent] Поиск в KB + memory: %s", message)
            # KB агента: top_k берём из настроек агента. Memory ниже ограничивает
            # выдачу своим значением из env.
            k = get_rag_chat_top_k("agent")
            hits: List[Hit] = []
            id_map: Dict[Any, str] = {}
            scopes_used: List[str] = []

            # Если у агента есть свой список KB-документов, поиск обязан идти
            # только по нему — иначе в выдачу приезжают чужие файлы.
            agent_doc_ids = [
                int(d)
                for d in ((context or {}).get("agent_kb_doc_ids") or [])
                if d is not None
            ]
            try:
                kb_hits = (
                    await rag_client.kb_search(
                        message,
                        k=k,
                        strategy=current_rag_strategy,
                        document_ids=agent_doc_ids or None,
                    )
                    or []
                )
                kb_hits = filter_rag_hits_by_score(
                    kb_hits, runtime_rag_similarity_threshold("agent")
                )
                if kb_hits:
                    scopes_used.append("agent")
                hits.extend(kb_hits)
                id_map.update(
                    build_rag_id_to_filename(
                        list(await rag_client.kb_list_documents() or [])
                    )
                )
            except Exception:
                logger.exception("DocumentAgent kb_search")

            try:
                mem_hits = (
                    await rag_client.memory_rag_search(
                        message, k=k, strategy=current_rag_strategy
                    )
                    or []
                )
                mem_hits = filter_rag_hits_by_score(
                    mem_hits, get_memory_similarity_threshold()
                )
                if mem_hits:
                    scopes_used.append("memory")
                hits.extend(mem_hits)
                id_map.update(
                    build_rag_id_to_filename(
                        list(await rag_client.memory_rag_list_documents() or [])
                    )
                )
            except Exception:
                logger.exception("DocumentAgent memory_rag_search")

            hits.sort(
                key=lambda h: float(h[1]) if h and len(h) > 1 else 0.0, reverse=True
            )
            hits = hits[:k]
            if not hits:
                return RAG_NO_RELEVANT_CONTEXT_MESSAGE

            logger.info("[DocumentAgent] Найдено фрагментов: %s", len(hits))
            pcts = hits_to_relevance_percents(hits)
            # Номер чанка и релевантность — только в лог: в CONTEXT они не нужны,
            # модель копирует эту разметку в ответ пользователю.
            logger.debug(
                "[DocumentAgent] чанки: %s",
                [
                    (rag_document_label(d, id_map), ci, f"{p}%")
                    for (_c, _s, d, ci), p in zip(hits, pcts)
                ],
            )
            context_parts = []
            total = 0
            # Документный агент работает по документам проекта — бюджет тот же,
            # что у проектного RAG (RAG_CONTEXT_MAX_TOKENS_PROJECT).
            budget = rag_context_max_chars("project")
            for i, (content, _score, doc_id, chunk_idx) in enumerate(hits, 1):
                title = rag_document_label(doc_id, id_map)
                frag = f"Фрагмент {i} (документ «{title}»): {content}\n"
                if total + len(frag) > budget:
                    break
                context_parts.append(frag)
                total += len(frag)
            document_context = "\n".join(context_parts)
            from backend.agent_llm_svc import ask_agent

            prompt = f"CONTEXT:\n\n{document_context}\n\nВопрос пользователя: {message}\n\nОтвет:"
            selected_model = context.get("selected_model") if context else None
            logger.info("Отправляем запрос к LLM с контекстом документов...")
            rag_override = (
                runtime_rag_system_prompt(scopes_used)
                or get_memory_system_prompt()
                or None
            )
            system_prompt = merge_strict_rag_system_prompt(
                None, rag_override=rag_override
            )
            if selected_model:
                logger.info("DocumentAgent использует модель: %s", selected_model)
                response = ask_agent(
                    prompt,
                    history=[],
                    streaming=False,
                    model_path=selected_model,
                    system_prompt=system_prompt,
                )
            else:
                logger.info("DocumentAgent использует модель по умолчанию")
                response = ask_agent(
                    prompt,
                    history=[],
                    streaming=False,
                    system_prompt=system_prompt,
                )
            response = await maybe_replace_ungrounded(
                prompt[:20000], response, RAG_STRICT_NOT_FOUND_MESSAGE
            )
            logger.info("Получен ответ от LLM, длина: %s символов", len(response))
            return response
        except Exception as e:
            logger.exception("Ошибка в DocumentAgent")
            return f"Произошла ошибка при поиске в документах: {str(e)}"

    def can_handle(self, message: str, context: Dict[str, Any] = None) -> bool:
        """Определяет, может ли агент обработать сообщение"""
        message_lower = message.lower()
        document_keywords = [
            "документ",
            "файл",
            "текст",
            "поиск в документах",
            "найди в файлах",
            "загруженные документы",
            "что в документах",
            "информация из файлов",
            "анализ документов",
        ]
        return any((keyword in message_lower for keyword in document_keywords))