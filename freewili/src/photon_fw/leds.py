"""LED pattern per state for the FREE-WILi OG's 7 RGB LEDs: (rgb, mode) applied to all, or a rainbow."""
from __future__ import annotations

from .state_machine import Machine, S

SOLID, FLASH, PULSE = 0, 1, 2  # OneWili owLEDManagerLEDMode: simplevalue, flash, pulse
RAINBOW = [(255, 60, 60), (255, 150, 0), (255, 230, 0), (60, 220, 120), (70, 150, 255), (150, 110, 255), (255, 90, 200)]
OFF = (0, 0, 0)


def pattern(m: Machine) -> tuple[tuple[int, int, int], int] | str:
    s, prox = m.state, m.ctx.proximity
    if s in (S.DOUBLE_YES, S.FOUND):
        return "rainbow"
    if s == S.IDLE:
        return (24, 40, 36), PULSE  # subtle mint breathing
    if s == S.SEARCHING:
        return (120, 90, 255), PULSE
    if s == S.MATCH_FOUND:
        return (255, 190, 20), FLASH  # faster: something to decide
    if s == S.WAITING:
        return (120, 90, 255), SOLID
    if s == S.NAVIGATING:
        # warmer = brighter and more active
        return [((60, 40, 120), PULSE), ((150, 90, 255), PULSE), ((255, 90, 120), FLASH), ((255, 90, 120), FLASH)][prox]
    if s == S.ERROR:
        return (255, 40, 40), FLASH
    return OFF, SOLID  # BOOT, OFFLINE: dark
