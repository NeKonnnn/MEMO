"""Loop-breaker и intent-without-action nudge (Terminus/Odysseus pattern)."""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field
from typing import List, Optional, Tuple


MAX_STUCK_ROUNDS = 4
RUNAWAY_CALL_THRESHOLD = 15
MAX_INTENT_NUDGES = 2

_INTENT_RE = re.compile(
    r"(?:^|\n)\s*(?:let me|i'?ll|i will|i need to|we need to|need to|"
    r"i should|we should|i must|we must|going to|let's|сейчас|сначала|"
    r"давай|нужно|проверю|посмотрю|удалю|создам|запишу)\s+"
    r"(?:tail|check|investigate|look at|see|read|fetch|inspect|verify|"
    r"diagnose|examine|debug|run|call|list|search|find|query|test|use|"
    r"perform|do|удал|созда|запиш|прочита|выполн)\b[^.\n]{0,140}",
    re.IGNORECASE,
)


@dataclass
class LoopGuardState:
    stuck_rounds: int = 0
    recent_call_sigs: List[str] = field(default_factory=list)
    call_freq: Counter = field(default_factory=Counter)
    intent_nudge_count: int = 0
    force_answer: bool = False

    def note_tool_round(self, *, sig: str, has_answer_text: bool) -> None:
        is_repeat = sig in self.recent_call_sigs
        self.recent_call_sigs.append(sig)
        if len(self.recent_call_sigs) > 32:
            self.recent_call_sigs.pop(0)
        self.call_freq[sig] += 1
        if is_repeat and not has_answer_text:
            self.stuck_rounds += 1
        else:
            self.stuck_rounds = 0

    def detect_runaway(self, threshold: int = RUNAWAY_CALL_THRESHOLD) -> Optional[str]:
        sig = next((s for s, n in self.call_freq.items() if n >= threshold), None)
        return sig.split(":", 1)[0] if sig else None

    def should_trip_breaker(self) -> Tuple[bool, str]:
        runaway = self.detect_runaway()
        if self.stuck_rounds >= MAX_STUCK_ROUNDS:
            return True, "repeating the same tool calls without new progress"
        if runaway:
            return True, f"calling {runaway} with identical arguments over and over"
        return False, ""

    def intent_nudge_message(self, response_text: str) -> Optional[str]:
        text = (response_text or "").strip()
        if not text or len(text) >= 400 or "```" in text:
            return None
        match = _INTENT_RE.search(text)
        if not match or self.intent_nudge_count >= MAX_INTENT_NUDGES:
            return None
        self.intent_nudge_count += 1
        phrase = match.group(0).strip()
        return (
            f"You wrote: \"{phrase}\" — but ended the turn without a tool call. "
            "Emit the actual function call now, or say plainly that you will not do it."
        )
