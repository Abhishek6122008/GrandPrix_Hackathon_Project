"""Prompt templates for the NLP advisory generator.

Keep ADVISORY_PROMPT in step with the PROMPT constant in
backend/src/main/java/com/crowdflow/service/advisory/AdvisoryService.java — if they drift,
the model sees a prompt it was never tuned on.

    python prompt_templates.py        # prints filled examples for eyeballing
"""

from __future__ import annotations

# What the backend sends per alert. One sentence out, because an operator reads it mid-shift.
ADVISORY_PROMPT = """You are a venue safety operator. In one sentence, tell staff what to do.
Zone: {zone_name} ({zone_type})
Occupancy: {occupancy_pct}% of capacity, {trend}
Suggested diversion: {diversion}
Advisory:"""

# Used on the summary screen: turns the whole run into a short recap.
SUMMARY_PROMPT = """Summarise this crowd simulation for an event organiser in two sentences.
Venue: {venue_name}
Attendance: {crowd_size}
Peak density without rerouting: {baseline_peak}%
Peak density with rerouting: {optimised_peak}%
Congested zones: {baseline_zones} -> {optimised_zones}
Summary:"""

# Prepended when the model needs steering toward operational language.
SYSTEM_PREAMBLE = (
    "You write terse, calm, actionable crowd-safety instructions. "
    "Never speculate about injuries. Name the zone and the action. No more than 25 words."
)

# Few-shot examples — cheap way to lock the tone before any fine-tuning.
FEW_SHOT = [
    {
        "zone_name": "Gate A",
        "zone_type": "gate",
        "occupancy_pct": 91,
        "trend": "rising",
        "diversion": "Divert to Gate B.",
        "advisory": "Act now: Gate A is at 91% and still filling — hold intake and send arrivals to Gate B.",
    },
    {
        "zone_name": "Food Court",
        "zone_type": "concession",
        "occupancy_pct": 74,
        "trend": "flat",
        "diversion": "Divert to East Concourse.",
        "advisory": "Heads up: Food Court is at 74% and steady — open the concourse route before the interval.",
    },
]


def build_advisory_prompt(zone_name: str, zone_type: str, occupancy_pct: int,
                          trend: str, diversion: str, few_shot: bool = False) -> str:
    """Fills ADVISORY_PROMPT, optionally prefixed with the few-shot examples."""
    prompt = ADVISORY_PROMPT.format(zone_name=zone_name, zone_type=zone_type,
                                    occupancy_pct=occupancy_pct, trend=trend, diversion=diversion)
    if not few_shot:
        return prompt
    examples = "\n\n".join(
        ADVISORY_PROMPT.format(**{k: v for k, v in ex.items() if k != "advisory"}) + " " + ex["advisory"]
        for ex in FEW_SHOT
    )
    return f"{SYSTEM_PREAMBLE}\n\n{examples}\n\n{prompt}"


if __name__ == "__main__":
    filled = build_advisory_prompt("Gate A", "gate", 91, "rising", "Divert to Gate B.", few_shot=True)
    assert "Gate A" in filled and filled.rstrip().endswith("Advisory:")
    assert "{" not in ADVISORY_PROMPT.format(zone_name="", zone_type="", occupancy_pct=0,
                                             trend="", diversion=""), "unfilled placeholder"
    print(filled)
