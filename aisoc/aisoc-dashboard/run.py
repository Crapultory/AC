#!/usr/bin/env python3
"""AISOC Dashboard Launcher"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))

from hypercorn.config import Config
from hypercorn.asyncio import serve
import asyncio
from app import app

config = Config()
config.bind = ["0.0.0.0:8890"]
config.accesslog = "-"

if __name__ == "__main__":
    asyncio.run(serve(app, config))
