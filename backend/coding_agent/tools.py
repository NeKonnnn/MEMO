"""Coding tools: filesystem + bash, confined to workspace."""

from __future__ import annotations

import asyncio
import difflib
import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

from backend.coding_agent.plan_policy import is_tool_allowed, plan_mode_block_message
from backend.coding_agent.workspace import env_with_workspace, resolve_under_workspace, skip_dir_names
from backend.settings.config import get_settings
from backend.settings.logging import get_logger

log = get_logger(__name__)

MAX_READ_CHARS = 120_000
MAX_OUTPUT_CHARS = 40_000
MAX_DIFF_LINES = 400
MAX_GREP_HITS = 200
MAX_LS_ENTRIES = 500

CODING_SYSTEM_HINT = """\
You are a coding agent working inside a local workspace folder.
Rules:
- Prefer get_workspace, ls, glob, grep, read_file to orient before edits.
- Use edit_file / apply_patch / write_file for code changes; use delete_file to remove files.
- Avoid bash redirects/heredocs for edits when a dedicated tool exists.
- Paths may be relative to the workspace or absolute but MUST stay inside it.
- In Plan mode you can only inspect (read/search); propose a plan, do not mutate files or run bash.
- Keep tool outputs concise; do not dump huge files unless necessary.
"""


def openai_tool_schemas() -> List[Dict[str, Any]]:
    return [
        {
            "type": "function",
            "function": {
                "name": "get_workspace",
                "description": "Return the absolute path of the active workspace folder.",
                "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "ls",
                "description": "List files and directories under a path (relative to workspace).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "description": "Directory path (default: workspace root)"},
                    },
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "glob",
                "description": "Find files by glob pattern under workspace (supports **).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "pattern": {"type": "string", "description": "Glob pattern, e.g. **/*.py"},
                        "path": {"type": "string", "description": "Optional subdirectory to search in"},
                    },
                    "required": ["pattern"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "grep",
                "description": "Search file contents with a regex pattern under workspace.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "pattern": {"type": "string"},
                        "path": {"type": "string", "description": "File or directory to search"},
                        "glob": {"type": "string", "description": "Optional filename glob filter"},
                        "case_insensitive": {"type": "boolean"},
                    },
                    "required": ["pattern"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "read_file",
                "description": "Read a text file from the workspace.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string"},
                        "offset": {"type": "integer", "description": "1-based start line"},
                        "limit": {"type": "integer", "description": "Max lines to return"},
                    },
                    "required": ["path"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "write_file",
                "description": "Create or overwrite a text file in the workspace.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string"},
                        "content": {"type": "string"},
                    },
                    "required": ["path", "content"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "delete_file",
                "description": "Delete a file from the workspace.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string"},
                    },
                    "required": ["path"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "edit_file",
                "description": "Replace exact old_string with new_string in a file.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string"},
                        "old_string": {"type": "string"},
                        "new_string": {"type": "string"},
                        "replace_all": {"type": "boolean"},
                    },
                    "required": ["path", "old_string", "new_string"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "apply_patch",
                "description": (
                    "Apply a multi-file patch. Sections: *** Add File: path, *** Update File: path, "
                    "*** Delete File: path. For Update, include <<<<<<< SEARCH / ======= / >>>>>>> REPLACE blocks."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "patch": {"type": "string"},
                    },
                    "required": ["patch"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "python",
                "description": "Run Python code in isolated mode (-I) with cwd set to the workspace.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "code": {"type": "string"},
                        "timeout_sec": {"type": "integer"},
                    },
                    "required": ["code"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "ask_user",
                "description": "Ask the user a multiple-choice question and wait for their answer.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "question": {"type": "string"},
                        "options": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "label": {"type": "string"},
                                    "description": {"type": "string"},
                                },
                                "required": ["label"],
                            },
                        },
                        "multi": {"type": "boolean"},
                    },
                    "required": ["question", "options"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "update_plan",
                "description": "Update the active approved plan checklist (mark steps done or revise).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "plan": {"type": "string", "description": "Full markdown checklist"},
                    },
                    "required": ["plan"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "bash",
                "description": "Run a shell command with cwd set to the workspace. Not sandboxed beyond cwd.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "command": {"type": "string"},
                        "timeout_sec": {"type": "integer"},
                    },
                    "required": ["command"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "todowrite",
                "description": "Write a short JSON todo list for tracking multi-step work.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "todos": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "id": {"type": "string"},
                                    "content": {"type": "string"},
                                    "status": {
                                        "type": "string",
                                        "enum": ["pending", "in_progress", "completed", "cancelled"],
                                    },
                                },
                                "required": ["content", "status"],
                            },
                        },
                    },
                    "required": ["todos"],
                    "additionalProperties": False,
                },
            },
        },
    ]


def _truncate(text: str, limit: int = MAX_OUTPUT_CHARS) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + f"\n… truncated at {limit} chars"


def _unified_diff(old: str, new: str, path: str) -> str:
    old_lines = old.splitlines()
    new_lines = new.splitlines()
    label = path or "file"
    diff_lines = list(
        difflib.unified_diff(
            old_lines,
            new_lines,
            fromfile=f"a/{label}",
            tofile=f"b/{label}",
            lineterm="",
        )
    )
    if len(diff_lines) > MAX_DIFF_LINES:
        diff_lines = diff_lines[:MAX_DIFF_LINES] + [f"… diff truncated at {MAX_DIFF_LINES} lines"]
    return "\n".join(diff_lines)


def _tool_ok(text: str, **extra: Any) -> Dict[str, Any]:
    out: Dict[str, Any] = {"ok": True, "output": _truncate(text)}
    out.update(extra)
    return out


def _tool_err(msg: str) -> Dict[str, Any]:
    return {"ok": False, "error": msg, "output": msg}


async def execute_coding_tool(
    name: str,
    arguments: Dict[str, Any],
    *,
    workspace: str,
    plan_mode: bool = False,
) -> Dict[str, Any]:
    tool = str(name or "").strip()
    if not is_tool_allowed(tool, plan_mode=plan_mode):
        return _tool_err(plan_mode_block_message(tool))

    args = arguments if isinstance(arguments, dict) else {}
    try:
        if tool == "get_workspace":
            return _tool_ok(workspace)
        if tool == "ls":
            return await asyncio.to_thread(_do_ls, workspace, args)
        if tool == "glob":
            return await asyncio.to_thread(_do_glob, workspace, args)
        if tool == "grep":
            return await asyncio.to_thread(_do_grep, workspace, args)
        if tool == "read_file":
            return await asyncio.to_thread(_do_read_file, workspace, args)
        if tool == "write_file":
            return await asyncio.to_thread(_do_write_file, workspace, args)
        if tool == "delete_file":
            return await asyncio.to_thread(_do_delete_file, workspace, args)
        if tool == "edit_file":
            return await asyncio.to_thread(_do_edit_file, workspace, args)
        if tool == "apply_patch":
            return await asyncio.to_thread(_do_apply_patch, workspace, args)
        if tool == "bash":
            return await _do_bash(workspace, args)
        if tool == "python":
            return await _do_python(workspace, args)
        if tool == "ask_user":
            return _do_ask_user(args)
        if tool == "update_plan":
            return _do_update_plan(args)
        if tool == "todowrite":
            todos = args.get("todos") or []
            return _tool_ok(json.dumps(todos, ensure_ascii=False, indent=2), todos=todos)
        return _tool_err(f"Unknown tool: {tool}")
    except Exception as exc:
        log.warning("coding tool %s failed: %s", tool, exc)
        return _tool_err(str(exc))


def _do_ls(workspace: str, args: Dict[str, Any]) -> Dict[str, Any]:
    path = resolve_under_workspace(workspace, args.get("path") or ".", must_exist=True)
    if not path.is_dir():
        return _tool_err(f"Not a directory: {path}")
    skip = skip_dir_names()
    entries: List[str] = []
    for child in sorted(path.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower())):
        if child.name in skip:
            continue
        suffix = "/" if child.is_dir() else ""
        entries.append(f"{child.name}{suffix}")
        if len(entries) >= MAX_LS_ENTRIES:
            entries.append("… truncated")
            break
    rel = path.relative_to(Path(workspace).resolve()) if path != Path(workspace).resolve() else Path(".")
    return _tool_ok(f"{rel.as_posix()}/\n" + "\n".join(entries) if entries else f"{rel.as_posix()}/\n(empty)")


def _glob_to_regex(pat: str) -> re.Pattern:
    i, n, out = 0, len(pat.replace("\\", "/")), []
    pat = pat.replace("\\", "/")
    while i < n:
        if pat[i : i + 3] == "**/":
            out.append("(?:[^/]+/)*")
            i += 3
        elif pat[i : i + 2] == "**":
            out.append(".*")
            i += 2
        elif pat[i] == "*":
            out.append("[^/]*")
            i += 1
        elif pat[i] == "?":
            out.append("[^/]")
            i += 1
        else:
            out.append(re.escape(pat[i]))
            i += 1
    return re.compile("^" + "".join(out) + "$")


def _do_glob(workspace: str, args: Dict[str, Any]) -> Dict[str, Any]:
    pattern = str(args.get("pattern") or "").strip()
    if not pattern:
        return _tool_err("pattern required")
    root = resolve_under_workspace(workspace, args.get("path") or ".", must_exist=True)
    if not root.is_dir():
        return _tool_err(f"Not a directory: {root}")
    rx = _glob_to_regex(pattern.lstrip("/"))
    skip = skip_dir_names()
    hits: List[str] = []
    ws = Path(workspace).resolve()
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in skip]
        base = Path(dirpath)
        for name in filenames:
            full = base / name
            try:
                rel = full.resolve().relative_to(ws).as_posix()
            except ValueError:
                continue
            if rx.match(rel) or rx.match(name):
                hits.append(rel)
                if len(hits) >= 200:
                    return _tool_ok("\n".join(hits) + "\n… truncated")
    return _tool_ok("\n".join(hits) if hits else "(no matches)")


def _do_grep(workspace: str, args: Dict[str, Any]) -> Dict[str, Any]:
    pattern = str(args.get("pattern") or "")
    if not pattern:
        return _tool_err("pattern required")
    flags = re.IGNORECASE if args.get("case_insensitive") else 0
    try:
        rx = re.compile(pattern, flags)
    except re.error as exc:
        return _tool_err(f"Invalid regex: {exc}")

    target = resolve_under_workspace(workspace, args.get("path") or ".", must_exist=True)
    file_glob = str(args.get("glob") or "").strip()
    file_rx = _glob_to_regex(file_glob) if file_glob else None
    skip = skip_dir_names()
    ws = Path(workspace).resolve()
    hits: List[str] = []

    def _scan_file(fp: Path) -> None:
        nonlocal hits
        if file_rx and not file_rx.match(fp.name) and not file_rx.match(fp.as_posix()):
            return
        try:
            text = fp.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return
        try:
            rel = fp.resolve().relative_to(ws).as_posix()
        except ValueError:
            return
        for i, line in enumerate(text.splitlines(), 1):
            if rx.search(line):
                clipped = line if len(line) <= 400 else line[:400] + "…"
                hits.append(f"{rel}:{i}:{clipped}")
                if len(hits) >= MAX_GREP_HITS:
                    return

    if target.is_file():
        _scan_file(target)
    else:
        for dirpath, dirnames, filenames in os.walk(target):
            dirnames[:] = [d for d in dirnames if d not in skip]
            for name in filenames:
                _scan_file(Path(dirpath) / name)
                if len(hits) >= MAX_GREP_HITS:
                    break
            if len(hits) >= MAX_GREP_HITS:
                break

    suffix = "\n… truncated" if len(hits) >= MAX_GREP_HITS else ""
    return _tool_ok(("\n".join(hits) if hits else "(no matches)") + suffix)


def _do_read_file(workspace: str, args: Dict[str, Any]) -> Dict[str, Any]:
    path = resolve_under_workspace(workspace, args.get("path"), must_exist=True)
    if not path.is_file():
        return _tool_err(f"Not a file: {path}")
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        return _tool_err(str(exc))
    lines = text.splitlines()
    offset = int(args.get("offset") or 1)
    limit = args.get("limit")
    if offset < 1:
        offset = 1
    start = offset - 1
    end = start + int(limit) if limit is not None else len(lines)
    sliced = lines[start:end]
    numbered = "\n".join(f"{start + i + 1}|{line}" for i, line in enumerate(sliced))
    body = numbered if numbered else "(empty)"
    if len(body) > MAX_READ_CHARS:
        body = body[:MAX_READ_CHARS] + f"\n… truncated at {MAX_READ_CHARS} chars"
    rel = path.relative_to(Path(workspace).resolve()).as_posix()
    return _tool_ok(f"# {rel}\n{body}")


def _do_write_file(workspace: str, args: Dict[str, Any]) -> Dict[str, Any]:
    path = resolve_under_workspace(workspace, args.get("path"))
    content = args.get("content")
    if content is None:
        return _tool_err("content required")
    path.parent.mkdir(parents=True, exist_ok=True)
    old = path.read_text(encoding="utf-8", errors="replace") if path.exists() else ""
    new = str(content)
    path.write_text(new, encoding="utf-8")
    rel = path.relative_to(Path(workspace).resolve()).as_posix()
    return _tool_ok(f"Wrote {rel}\n{_unified_diff(old, new, rel)}")


def _do_delete_file(workspace: str, args: Dict[str, Any]) -> Dict[str, Any]:
    path = resolve_under_workspace(workspace, args.get("path"), must_exist=True)
    if path.is_dir():
        return _tool_err(f"Not a file: {path}")
    rel = path.relative_to(Path(workspace).resolve()).as_posix()
    path.unlink()
    return _tool_ok(f"Deleted {rel}")


def _do_edit_file(workspace: str, args: Dict[str, Any]) -> Dict[str, Any]:
    path = resolve_under_workspace(workspace, args.get("path"), must_exist=True)
    old_s = args.get("old_string", "")
    new_s = args.get("new_string", "")
    replace_all = bool(args.get("replace_all", False))
    if old_s == "":
        return _tool_err("old_string required (use write_file to create)")
    if old_s == new_s:
        return _tool_err("old_string and new_string are identical")
    original = path.read_text(encoding="utf-8", errors="replace")
    count = original.count(old_s)
    if count == 0:
        return _tool_err("old_string not found in file")
    if count > 1 and not replace_all:
        return _tool_err(f"old_string found {count} times; set replace_all=true or make it unique")
    updated = original.replace(old_s, str(new_s)) if replace_all else original.replace(old_s, str(new_s), 1)
    path.write_text(updated, encoding="utf-8")
    rel = path.relative_to(Path(workspace).resolve()).as_posix()
    return _tool_ok(f"Edited {rel}\n{_unified_diff(original, updated, rel)}")


_SEARCH_RE = re.compile(
    r"<<<<<<< SEARCH\n(.*?)\n=======\n(.*?)\n>>>>>>> REPLACE",
    re.DOTALL,
)


def _do_apply_patch(workspace: str, args: Dict[str, Any]) -> Dict[str, Any]:
    patch = str(args.get("patch") or "")
    if not patch.strip():
        return _tool_err("patch required")

    lines = patch.replace("\r\n", "\n").split("\n")
    results: List[str] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if line.startswith("*** Add File:"):
            rel = line[len("*** Add File:") :].strip()
            i += 1
            content_lines: List[str] = []
            while i < len(lines) and not lines[i].startswith("*** "):
                content_lines.append(lines[i])
                i += 1
            path = resolve_under_workspace(workspace, rel)
            path.parent.mkdir(parents=True, exist_ok=True)
            text = "\n".join(content_lines)
            if content_lines:
                text += "\n" if patch.endswith("\n") or True else ""
            path.write_text("\n".join(content_lines) + ("\n" if content_lines else ""), encoding="utf-8")
            results.append(f"Added {rel}")
            continue
        if line.startswith("*** Delete File:"):
            rel = line[len("*** Delete File:") :].strip()
            path = resolve_under_workspace(workspace, rel, must_exist=True)
            path.unlink()
            results.append(f"Deleted {rel}")
            i += 1
            continue
        if line.startswith("*** Update File:"):
            rel = line[len("*** Update File:") :].strip()
            i += 1
            block_lines: List[str] = []
            while i < len(lines) and not lines[i].startswith("*** "):
                block_lines.append(lines[i])
                i += 1
            block = "\n".join(block_lines)
            path = resolve_under_workspace(workspace, rel, must_exist=True)
            original = path.read_text(encoding="utf-8", errors="replace")
            updated = original
            matches = list(_SEARCH_RE.finditer(block))
            if not matches:
                return _tool_err(f"Update {rel}: no SEARCH/REPLACE blocks")
            for m in matches:
                old_s, new_s = m.group(1), m.group(2)
                if old_s not in updated:
                    return _tool_err(f"Update {rel}: SEARCH block not found")
                updated = updated.replace(old_s, new_s, 1)
            path.write_text(updated, encoding="utf-8")
            results.append(f"Updated {rel}\n{_unified_diff(original, updated, rel)}")
            continue
        i += 1

    if not results:
        return _tool_err("No patch sections found (*** Add/Update/Delete File:)")
    return _tool_ok("\n\n".join(results))


async def _do_python(workspace: str, args: Dict[str, Any]) -> Dict[str, Any]:
    code = str(args.get("code") or "").strip()
    if not code:
        return _tool_err("code required")
    cfg = get_settings()
    coding = getattr(cfg, "coding_agent", None)
    default_timeout = int(getattr(coding, "python_timeout_sec", 60) or 60)
    timeout = int(args.get("timeout_sec") or default_timeout)
    timeout = max(1, min(timeout, 600))

    create = asyncio.create_subprocess_exec(
        sys.executable,
        "-I",
        "-c",
        code,
        cwd=workspace,
        env=env_with_workspace(workspace),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    proc = await create
    try:
        out_b, err_b = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        try:
            proc.kill()
        except ProcessLookupError:
            pass
        return _tool_err(f"Python timed out after {timeout}s")

    out = out_b.decode("utf-8", errors="replace")
    err = err_b.decode("utf-8", errors="replace")
    code_rc = proc.returncode or 0
    body = out
    if err:
        body += (("\n" if body else "") + f"[stderr]\n{err}")
    body = body or "(no output)"
    return {
        "ok": code_rc == 0,
        "exit_code": code_rc,
        "output": _truncate(body),
        "error": None if code_rc == 0 else f"exit_code={code_rc}",
    }


def _do_ask_user(args: Dict[str, Any]) -> Dict[str, Any]:
    question = str(args.get("question") or "").strip()
    options_raw = args.get("options") or []
    multi = bool(args.get("multi"))
    options: List[Dict[str, str]] = []
    for opt in options_raw:
        if isinstance(opt, dict):
            label = str(opt.get("label") or "").strip()
            descr = str(opt.get("description") or "").strip()
        elif isinstance(opt, str):
            label, descr = opt.strip(), ""
        else:
            continue
        if label:
            options.append({"label": label, "description": descr})
    if not question or len(options) < 2:
        return _tool_err("ask_user needs question and at least 2 options")
    options = options[:6]
    payload = {"question": question, "options": options, "multi": multi}
    labels = ", ".join(o["label"] for o in options)
    return {
        "ok": True,
        "ask_user": payload,
        "output": f"Asked the user: {question}\nOptions: {labels}",
        "await_user": True,
    }


def _do_update_plan(args: Dict[str, Any]) -> Dict[str, Any]:
    plan = str(args.get("plan") or "").strip()
    if not plan:
        return _tool_err("plan required")
    plan = plan[:8192]
    done = plan.count("- [x]") + plan.count("- [X]")
    total = done + plan.count("- [ ]")
    return {
        "ok": True,
        "plan_update": {"plan": plan},
        "output": f"Plan updated ({done}/{total} steps complete)." if total else "Plan updated.",
    }


async def _do_bash(workspace: str, args: Dict[str, Any]) -> Dict[str, Any]:
    command = str(args.get("command") or "").strip()
    if not command:
        return _tool_err("command required")
    cfg = get_settings()
    coding = getattr(cfg, "coding_agent", None)
    default_timeout = int(getattr(coding, "bash_timeout_sec", 60) or 60)
    timeout = int(args.get("timeout_sec") or default_timeout)
    timeout = max(1, min(timeout, 600))

    shell = os.environ.get("COMSPEC") if os.name == "nt" else "/bin/bash"
    if os.name == "nt":
        create = asyncio.create_subprocess_exec(
            shell,
            "/c",
            command,
            cwd=workspace,
            env=env_with_workspace(workspace),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    else:
        create = asyncio.create_subprocess_exec(
            shell,
            "-lc",
            command,
            cwd=workspace,
            env=env_with_workspace(workspace),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

    proc = await create
    try:
        out_b, err_b = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        try:
            proc.kill()
        except ProcessLookupError:
            pass
        return _tool_err(f"Command timed out after {timeout}s")

    out = out_b.decode("utf-8", errors="replace")
    err = err_b.decode("utf-8", errors="replace")
    code = proc.returncode or 0
    body = ""
    if out:
        body += out
    if err:
        body += (("\n" if body else "") + f"[stderr]\n{err}")
    body = body or "(no output)"
    return {
        "ok": code == 0,
        "exit_code": code,
        "output": _truncate(body),
        "error": None if code == 0 else f"exit_code={code}",
    }


def format_tool_result_for_llm(result: Dict[str, Any]) -> str:
    if result.get("ok"):
        return str(result.get("output") or "")
    err = result.get("error") or result.get("output") or "tool failed"
    return f"ERROR: {err}"
