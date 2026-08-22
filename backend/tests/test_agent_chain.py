from backend.agents.chain import (
    MAX_CHAIN_AGENTS,
    build_chain_user_message,
    format_visible_chain_content,
    iter_chain_stream_prefixes,
    parse_agent_ids,
    parse_recursion_limit,
    resolve_agent_steps,
)


def test_parse_agent_ids_filters_self_dupes_and_limit():
    raw = [1, "2", 2, "x", 0, -3, 1, *range(10, 30)]
    got = parse_agent_ids(raw, exclude_id=1)
    assert 1 not in got
    assert got[0] == 2
    assert len(got) == MAX_CHAIN_AGENTS
    assert len(set(got)) == len(got)


def test_build_chain_user_message_includes_previous_outputs():
    text = build_chain_user_message(
        "Суммируй договор",
        [{"agent_name": "Юрист", "content": "Рисков нет"}],
    )
    assert "Суммируй договор" in text
    assert "Юрист" in text
    assert "Рисков нет" in text
    assert "specific expertise" in text


def test_format_visible_hides_intermediate():
    steps = [
        {"agent_name": "A", "content": "one"},
        {"agent_name": "B", "content": "two"},
    ]
    hidden = format_visible_chain_content(steps, hide_sequential_outputs=True)
    shown = format_visible_chain_content(steps, hide_sequential_outputs=False)
    assert hidden == "two"
    assert "**▸ A**" in shown and "**▸ B**" in shown
    assert "one" in shown and "two" in shown


def test_stream_prefix_grows_with_steps():
    prefix, header = iter_chain_stream_prefixes([], "Аналитик", hide_sequential_outputs=False)
    assert prefix.startswith("**▸ Аналитик**")
    assert header == prefix
    later, _ = iter_chain_stream_prefixes(
        [{"agent_name": "Аналитик", "content": "готово"}],
        "Юрист",
        hide_sequential_outputs=False,
    )
    assert "готово" in later
    assert "**▸ Юрист**" in later
    empty, empty_h = iter_chain_stream_prefixes([], "X", hide_sequential_outputs=True)
    assert empty == "" and empty_h == ""


def test_parse_recursion_limit():
    assert parse_recursion_limit(None) is None
    assert parse_recursion_limit("") is None
    assert parse_recursion_limit(0) is None
    assert parse_recursion_limit(25) == 25
    assert parse_recursion_limit(1000) == 100
    assert resolve_agent_steps({"recursion_limit": 12}) == 12
    assert resolve_agent_steps({}) == 25
