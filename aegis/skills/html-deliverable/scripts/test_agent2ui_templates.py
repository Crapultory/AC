#!/usr/bin/env python3
"""Verify that every bundled template ships the Agent2UI interaction contract."""

from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import NamedTemporaryFile

from validate_html import validate


SKILL_DIR = Path(__file__).resolve().parents[1]
TEMPLATES = SKILL_DIR / "assets" / "templates"


class Agent2UITemplateTests(unittest.TestCase):
    def test_validator_rejects_forms_with_network_or_navigation_attributes(self) -> None:
        document = """<!doctype html><html><head><title>Test</title></head><body><form action=\"https://example.com\" target=\"_blank\"><input></form></body></html>"""
        with NamedTemporaryFile(mode="w", suffix=".html", encoding="utf-8") as output:
            output.write(document)
            output.flush()
            errors = validate(Path(output.name))

        self.assertIn("Forms must not set action, method, or target attributes.", errors)

    def test_every_template_inlines_the_bridge_and_interactive_objects(self) -> None:
        bridge = (SKILL_DIR / "assets" / "agent2ui-bridge.js").read_text(
            encoding="utf-8",
        )
        for template in sorted(TEMPLATES.glob("*.html")):
            with self.subTest(template=template.name):
                content = template.read_text(encoding="utf-8")
                self.assertIn(bridge, content)
                self.assertIn("aegis-agent2ui", content)
                self.assertIn("composer.insert", content)
                self.assertIn("data-agent2ui-content", content)
                self.assertIn("进一步分析", content)
                self.assertIn("进一步调查", content)
                self.assertIn("自定义前缀", content)
                self.assertNotIn('src="../agent2ui-bridge.js"', content)


if __name__ == "__main__":
    unittest.main()
