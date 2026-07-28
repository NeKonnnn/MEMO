"""Plan mode и approved plan (паттерн Odysseus)."""

from __future__ import annotations

PLAN_MODE_DIRECTIVE = """\
## PLAN MODE — OVERRIDES EVERYTHING ELSE BELOW
You are in PLAN MODE. Your ONLY job this turn is to PROPOSE a plan. You have NOT done anything yet.
Do NOT claim you created, wrote, ran, or changed anything.

ABSOLUTE RULE — DO NOT MUTATE ANYTHING. Write/shell tools are disabled; only read-only tools work.
Use read_file, ls, glob, grep, get_workspace to inspect the project if needed.

OUTPUT: present the plan as a GitHub-style checklist:
- [ ] first action once approved
- [ ] next action
Do not execute. End your turn with the checklist. The user will approve the plan in the UI.
"""


def build_active_plan_note(approved_plan: str) -> str:
    if not approved_plan or not approved_plan.strip():
        return ""
    return (
        "## ACTIVE PLAN (approved — execute this)\n"
        "You are executing a plan the user already approved. Work through it IN ORDER. "
        "After finishing each step, call `update_plan` with the full checklist and that step marked `- [x]`. "
        "If the user asks to change the plan, call `update_plan` with the revised checklist.\n\n"
        + approved_plan.strip()
    )
