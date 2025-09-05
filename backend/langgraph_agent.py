"""
LangGraph Agent для MemoAI
Реализует многошаговое планирование и выполнение задач
"""

from typing import TypedDict, Annotated, Sequence, List, Dict, Any, Optional
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, ToolMessage
from langchain_core.tools import tool
from langchain_core.runnables import RunnableConfig
from langgraph.graph import StateGraph, END, START
from langgraph.graph.message import add_messages
from langgraph.prebuilt.tool_node import ToolNode
from langgraph.checkpoint.memory import MemorySaver
import json
import logging

logger = logging.getLogger(__name__)

# Состояние агента
class AgentState(TypedDict):
    """Состояние агента LangGraph"""
    messages: Annotated[Sequence[BaseMessage], add_messages]
    current_task: Optional[str]
    task_steps: List[str]
    completed_steps: List[str]
    tool_results: Dict[str, Any]
    final_answer: Optional[str]
    error: Optional[str]

# Система инструментов
@tool
def search_documents(query: str) -> str:
    """Поиск информации в загруженных документах"""
    try:
        from backend.document_processor import doc_processor
        if doc_processor and doc_processor.vectorstore:
            # Поиск в векторном хранилище
            docs = doc_processor.vectorstore.similarity_search(query, k=3)
            if docs:
                results = []
                for doc in docs:
                    results.append(f"Документ: {doc.metadata.get('source', 'Unknown')}\nСодержание: {doc.page_content[:500]}...")
                return "\n\n".join(results)
            else:
                return "В загруженных документах не найдено информации по запросу."
        else:
            return "Документы не загружены или векторное хранилище недоступно."
    except Exception as e:
        logger.error(f"Ошибка поиска в документах: {e}")
        return f"Ошибка при поиске в документах: {str(e)}"

@tool
def get_web_search(query: str) -> str:
    """Поиск информации в интернете"""
    try:
        # Здесь можно интегрировать реальный поиск (например, через SerpAPI)
        # Пока возвращаем заглушку
        return f"Результаты поиска в интернете по запросу '{query}': [Интеграция с поисковой системой в разработке]"
    except Exception as e:
        logger.error(f"Ошибка веб-поиска: {e}")
        return f"Ошибка при поиске в интернете: {str(e)}"

@tool
def save_to_memory(content: str, category: str = "general") -> str:
    """Сохранение важной информации в память"""
    try:
        from backend.memory import save_dialog_entry
        if save_dialog_entry:
            save_dialog_entry("system", f"[{category}] {content}")
            return f"Информация сохранена в память в категории '{category}'"
        else:
            return "Модуль памяти недоступен"
    except Exception as e:
        logger.error(f"Ошибка сохранения в память: {e}")
        return f"Ошибка при сохранении в память: {str(e)}"

@tool
def calculate_math(expression: str) -> str:
    """Выполнение математических вычислений"""
    try:
        # Безопасное вычисление математических выражений
        allowed_chars = set('0123456789+-*/()., ')
        if not all(c in allowed_chars for c in expression):
            return "Ошибка: недопустимые символы в выражении"
        
        result = eval(expression)
        return f"Результат: {result}"
    except Exception as e:
        return f"Ошибка вычисления: {str(e)}"

# Список доступных инструментов
TOOLS = [search_documents, get_web_search, save_to_memory, calculate_math]

class LangGraphAgent:
    """Агент на основе LangGraph с планированием и инструментами"""
    
    def __init__(self, llm_model=None):
        self.llm = llm_model
        self.tools = TOOLS
        self.tool_node = ToolNode(self.tools)
        self.memory = MemorySaver()
        self.graph = self._build_graph()
        
    def _build_graph(self) -> StateGraph:
        """Построение графа состояний агента"""
        
        def should_continue(state: AgentState) -> str:
            """Определяет, нужно ли продолжать выполнение"""
            messages = state["messages"]
            last_message = messages[-1]
            
            # Если есть вызовы инструментов, выполняем их
            if hasattr(last_message, 'tool_calls') and last_message.tool_calls:
                return "tools"
            
            # Если есть ошибка, завершаем
            if state.get("error"):
                return "end"
                
            # Если задача выполнена, завершаем
            if state.get("final_answer"):
                return "end"
                
            return "end"
        
        def call_model(state: AgentState, config: RunnableConfig) -> Dict[str, Any]:
            """Вызов LLM модели"""
            try:
                from backend.agent import ask_agent
                
                # Получаем последнее сообщение пользователя
                user_message = None
                for msg in reversed(state["messages"]):
                    if isinstance(msg, HumanMessage):
                        user_message = msg.content
                        break
                
                if not user_message:
                    return {"error": "Не найдено сообщение пользователя"}
                
                # Подготавливаем историю для LLM
                history = []
                for msg in state["messages"][:-1]:  # Исключаем последнее сообщение
                    if isinstance(msg, HumanMessage):
                        history.append({"role": "user", "content": msg.content})
                    elif isinstance(msg, AIMessage):
                        history.append({"role": "assistant", "content": msg.content})
                
                # Создаем промпт с инструкциями по использованию инструментов
                system_prompt = """Ты умный ассистент с доступом к инструментам. 
                
Доступные инструменты:
- search_documents: поиск в загруженных документах
- get_web_search: поиск в интернете  
- save_to_memory: сохранение информации в память
- calculate_math: выполнение математических вычислений

Если тебе нужна информация из документов, используй search_documents.
Если нужна актуальная информация из интернета, используй get_web_search.
Если нужно выполнить вычисления, используй calculate_math.
Если информация важна, сохрани её с помощью save_to_memory.

Отвечай подробно и по существу."""
                
                # Вызываем LLM
                response = ask_agent(
                    user_message, 
                    history=history,
                    streaming=False
                )
                
                return {"messages": [AIMessage(content=response)]}
                
            except Exception as e:
                logger.error(f"Ошибка в call_model: {e}")
                return {"error": f"Ошибка LLM: {str(e)}"}
        
        def call_tools(state: AgentState, config: RunnableConfig) -> Dict[str, Any]:
            """Выполнение инструментов"""
            try:
                return self.tool_node.invoke(state, config)
            except Exception as e:
                logger.error(f"Ошибка в call_tools: {e}")
                return {"error": f"Ошибка выполнения инструментов: {str(e)}"}
        
        # Строим граф
        workflow = StateGraph(AgentState)
        
        # Добавляем узлы
        workflow.add_node("agent", call_model)
        workflow.add_node("tools", call_tools)
        
        # Добавляем рёбра
        workflow.add_edge(START, "agent")
        workflow.add_conditional_edges(
            "agent",
            should_continue,
            {
                "tools": "tools",
                "end": END
            }
        )
        workflow.add_edge("tools", "agent")
        
        return workflow.compile(checkpointer=self.memory)
    
    async def process_message(self, message: str, session_id: str = "default") -> str:
        """Обработка сообщения пользователя"""
        try:
            # Создаем начальное состояние
            initial_state = {
                "messages": [HumanMessage(content=message)],
                "current_task": None,
                "task_steps": [],
                "completed_steps": [],
                "tool_results": {},
                "final_answer": None,
                "error": None
            }
            
            # Выполняем граф
            config = {"configurable": {"thread_id": session_id}}
            result = await self.graph.ainvoke(initial_state, config)
            
            # Извлекаем ответ
            if result.get("error"):
                return f"Ошибка: {result['error']}"
            
            # Получаем последнее сообщение от агента
            messages = result.get("messages", [])
            for msg in reversed(messages):
                if isinstance(msg, AIMessage):
                    return msg.content
            
            return "Не удалось получить ответ от агента"
            
        except Exception as e:
            logger.error(f"Ошибка в process_message: {e}")
            return f"Ошибка обработки сообщения: {str(e)}"
    
    def process_message_sync(self, message: str, session_id: str = "default") -> str:
        """Синхронная обработка сообщения"""
        import asyncio
        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
        
        return loop.run_until_complete(self.process_message(message, session_id))

# Глобальный экземпляр агента
langgraph_agent = None

def initialize_langgraph_agent():
    """Инициализация LangGraph агента"""
    global langgraph_agent
    try:
        langgraph_agent = LangGraphAgent()
        logger.info("LangGraph агент успешно инициализирован")
        return True
    except Exception as e:
        logger.error(f"Ошибка инициализации LangGraph агента: {e}")
        return False

def get_langgraph_agent():
    """Получение экземпляра LangGraph агента"""
    global langgraph_agent
    if langgraph_agent is None:
        initialize_langgraph_agent()
    return langgraph_agent

