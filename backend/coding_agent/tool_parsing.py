"""Парсинг tool-вызовов из текста модели (fenced blocks, XML, [TOOL_CALL])."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from backend.llm_providers.base import ToolCall

CODING_TOOL_TAGS = (
    "bash",
    "python",
    "read_file",
    "write_file",
    "edit_file",
    "apply_patch",
    "delete_file",
    "grep",
    "glob",
    "ls",
    "get_workspace",
    "todowrite",
    "ask_user",
    "update_plan",
)

_CODE_FENCE_TAGS = frozenset({"bash", "python"})

_TOOL_BLOCK_RE = re.compile(
    r"```(" + "|".join(CODING_TOOL_TAGS) + r")(?![\w-])"
    r"[ \t]*([{\[][^\n]*?)?[ \t]*(?=\r?\n|```)\r?\n?([\s\S]*?)```",
    re.IGNORECASE,
)
_TOOL_CALL_BLOCK_RE = re.compile(r"<tool_call>\s*(.*?)\s*</tool_call>", re.DOTALL | re.IGNORECASE)
_TOOL_CALL_BRACKET_RE = re.compile(r"\[TOOL_CALL\]\s*(\{[\s\S]*?\})\s*\[/TOOL_CALL\]", re.IGNORECASE)
_XML_INVOKE_RE = re.compile(
    r'<invoke\s+name=["\'](\w+)["\']>\s*([\s\S]*?)</invoke>',
    re.IGNORECASE,
)
_XML_PARAM_RE = re.compile(
    r'<parameter\s+name=["\'](\w+)["\']>([\s\S]*?)</parameter>',
    re.IGNORECASE,
)


@dataclass
class ParsedToolBlock:
    tool_type: str
    content: str


def _fenced_tool_call(match: re.Match) -> Optional[tuple[str, str]]:
    tag = match.group(1).lower()
    inline = (match.group(2) or "").strip()
    body = (match.group(3) or "").strip()
    if not inline:
        return tag, body
    if tag in _CODE_FENCE_TAGS:
        return None
    content = f"{inline}\n{body}" if body else inline
    try:
        json.loads(content)
    except (ValueError, TypeError):
        return None
    return tag, content


def _xml_invoke_to_content(tool_name: str, body: str) -> str:
    args: Dict[str, Any] = {}
    for pm in _XML_PARAM_RE.finditer(body):
        args[pm.group(1)] = pm.group(2).strip()
    if tool_name in _CODE_FENCE_TAGS and "command" in args:
        return args["command"]
    if tool_name == "python" and "code" in args:
        return args["code"]
    return json.dumps(args, ensure_ascii=False)


def _block_to_tool_call(block: ParsedToolBlock, idx: int) -> Optional[ToolCall]:
    name = block.tool_type
    raw = (block.content or "").strip()
    if name in _CODE_FENCE_TAGS:
        arg_key = "command" if name == "bash" else "code"
        return ToolCall(id=f"fenced_{idx}", name=name, arguments={arg_key: raw})
    if name == "get_workspace":
        return ToolCall(id=f"fenced_{idx}", name=name, arguments={})
    try:
        args = json.loads(raw) if raw else {}
    except json.JSONDecodeError:
        args = {"raw": raw}
    if not isinstance(args, dict):
        args = {"raw": args}
    return ToolCall(id=f"fenced_{idx}", name=name, arguments=args)


def parse_tool_blocks(text: str, *, skip_fenced: bool = False) -> List[ParsedToolBlock]:
    blocks: List[ParsedToolBlock] = []
    if not text:
        return blocks

    if not skip_fenced:
        for m in _TOOL_BLOCK_RE.finditer(text):
            call = _fenced_tool_call(m)
            if call is None:
                continue
            tag, content = call
            if not content and tag not in ("get_workspace",):
                continue
            blocks.append(ParsedToolBlock(tag, content))

    if not blocks:
        for m in _TOOL_CALL_BRACKET_RE.finditer(text):
            try:
                data = json.loads(m.group(1))
            except json.JSONDecodeError:
                continue
            tool = str(data.get("tool") or data.get("name") or "").strip()
            args = data.get("args") or data.get("arguments") or {}
            if not tool:
                continue
            content = json.dumps(args, ensure_ascii=False) if isinstance(args, dict) else str(args)
            blocks.append(ParsedToolBlock(tool, content))

    if not blocks:
        for inv_name, inv_body in _XML_INVOKE_RE.finditer(text):
            name = inv_name.group(1).lower()
            if name not in CODING_TOOL_TAGS:
                continue
            blocks.append(ParsedToolBlock(name, _xml_invoke_to_content(name, inv_body.group(2))))

    return blocks


def parsed_blocks_to_tool_calls(blocks: List[ParsedToolBlock]) -> List[ToolCall]:
    out: List[ToolCall] = []
    for idx, block in enumerate(blocks):
        tc = _block_to_tool_call(block, idx)
        if tc:
            out.append(tc)
    return out


def _extract_json_tool_calls(content: str) -> List[ToolCall]:
    out: List[ToolCall] = []
    if not content:
        return out
    import time

    for idx, match in enumerate(_TOOL_CALL_BLOCK_RE.findall(content)):
        try:
            data = json.loads(match)
            name = str(data.get("name") or "").strip()
            if not name:
                continue
            args = data.get("arguments") or {}
            if not isinstance(args, dict):
                args = {"raw": args}
            out.append(
                ToolCall(
                    id=f"parsed_{idx}_{int(time.time())}",
                    name=name,
                    arguments=args,
                )
            )
        except (json.JSONDecodeError, TypeError, ValueError):
            continue
    return out


def extract_tool_calls_from_content(content: str, *, skip_fenced: bool = False) -> List[ToolCall]:
    """Native FC fallback: fenced/XML + legacy <tool_call> JSON."""
    blocks = parse_tool_blocks(content, skip_fenced=skip_fenced)
    if blocks:
        return parsed_blocks_to_tool_calls(blocks)
    return _extract_json_tool_calls(content)
