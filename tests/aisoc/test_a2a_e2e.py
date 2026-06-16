from __future__ import annotations

import asyncio
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

import httpx
import pytest


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


@pytest.mark.asyncio
async def test_hermes_aisoc_a2a_e2e_message_roundtrip() -> None:
    port = _free_port()
    env = os.environ.copy()
    env["AISOC_A2A_TEST_MODE"] = "echo"
    env["PYTHONPATH"] = os.getcwd()

    proc = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "hermes_cli.main",
            "aisoc",
            "--model",
            "a2a",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
        ],
        cwd=os.getcwd(),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        async with httpx.AsyncClient() as probe:
            deadline = time.monotonic() + 15
            last_error = None
            while time.monotonic() < deadline:
                try:
                    response = await probe.get(f"http://127.0.0.1:{port}/health")
                    if response.status_code == 200:
                        break
                except Exception as exc:  # pragma: no cover - diagnostic path
                    last_error = exc
                await asyncio.sleep(0.1)
            else:
                stdout, stderr = proc.communicate(timeout=2)
                raise AssertionError(
                    f"A2A server did not become healthy. last_error={last_error!r}\nstdout={stdout}\nstderr={stderr}"
                )

        script = Path(__file__).resolve().parents[2] / "scripts" / "a2a_smoke_test.py"
        result = await asyncio.to_thread(
            subprocess.run,
            [
                sys.executable,
                str(script),
                "--base-url",
                f"http://127.0.0.1:{port}",
                "--single-message",
                "hello from e2e",
                "--multi-first-message",
                "first turn",
                "--multi-second-message",
                "follow up",
                "--expected-single-response",
                "echo(turn=1): hello from e2e",
                "--expected-multi-first-response",
                "echo(turn=1): first turn",
                "--expected-multi-second-response",
                "echo(turn=2): follow up",
            ],
            cwd=os.getcwd(),
            env=env,
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        assert result.returncode == 0, f"stdout={result.stdout}\nstderr={result.stderr}"
        assert "agent_card_url:" in result.stdout
        assert "single_turn: ok" in result.stdout
        assert "multi_turn: ok" in result.stdout
        assert "a2a smoke test passed" in result.stdout
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=5)


@pytest.mark.asyncio
async def test_hermes_aisoc_a2a_e2e_streaming_roundtrip() -> None:
    port = _free_port()
    env = os.environ.copy()
    env["AISOC_A2A_TEST_MODE"] = "echo"
    env["PYTHONPATH"] = os.getcwd()

    proc = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "hermes_cli.main",
            "aisoc",
            "--module",
            "a2a",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "--streaming",
        ],
        cwd=os.getcwd(),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        async with httpx.AsyncClient() as probe:
            deadline = time.monotonic() + 15
            last_error = None
            while time.monotonic() < deadline:
                try:
                    response = await probe.get(
                        f"http://127.0.0.1:{port}/.well-known/agent-card.json"
                    )
                    if response.status_code == 200 and response.json()["capabilities"]["streaming"]:
                        break
                except Exception as exc:  # pragma: no cover - diagnostic path
                    last_error = exc
                await asyncio.sleep(0.1)
            else:
                stdout, stderr = proc.communicate(timeout=2)
                raise AssertionError(
                    "A2A streaming server did not become ready. "
                    f"last_error={last_error!r}\nstdout={stdout}\nstderr={stderr}"
                )

        script = Path(__file__).resolve().parents[2] / "scripts" / "a2a_smoke_test.py"
        result = await asyncio.to_thread(
            subprocess.run,
            [
                sys.executable,
                str(script),
                "--base-url",
                f"http://127.0.0.1:{port}",
                "--streaming",
                "--single-message",
                "hello from streaming e2e",
                "--expected-single-response",
                "echo(turn=1): hello from streaming e2e",
            ],
            cwd=os.getcwd(),
            env=env,
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        assert result.returncode == 0, f"stdout={result.stdout}\nstderr={result.stderr}"
        assert "streaming_turn: ok" in result.stdout
        assert "stream_event: working ->" in result.stdout
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=5)


@pytest.mark.asyncio
async def test_hermes_aisoc_a2a_e2e_message_roundtrip_with_auth() -> None:
    port = _free_port()
    env = os.environ.copy()
    env["AISOC_A2A_TEST_MODE"] = "echo"
    env["AISOC_A2A_AUTH"] = "true"
    env["A2A_SESSION_TOKEN"] = "e2e-a2a-token"
    env["PYTHONPATH"] = os.getcwd()

    proc = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "hermes_cli.main",
            "aisoc",
            "--module",
            "a2a",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
        ],
        cwd=os.getcwd(),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        async with httpx.AsyncClient() as probe:
            deadline = time.monotonic() + 15
            last_error = None
            while time.monotonic() < deadline:
                try:
                    response = await probe.get(
                        f"http://127.0.0.1:{port}/.well-known/agent-card.json"
                    )
                    if response.status_code == 200:
                        break
                except Exception as exc:  # pragma: no cover - diagnostic path
                    last_error = exc
                await asyncio.sleep(0.1)
            else:
                stdout, stderr = proc.communicate(timeout=2)
                raise AssertionError(
                    "A2A auth-enabled server did not become ready. "
                    f"last_error={last_error!r}\nstdout={stdout}\nstderr={stderr}"
                )

        script = Path(__file__).resolve().parents[2] / "scripts" / "a2a_smoke_test.py"
        result = await asyncio.to_thread(
            subprocess.run,
            [
                sys.executable,
                str(script),
                "--base-url",
                f"http://127.0.0.1:{port}",
                "--auth-token",
                "e2e-a2a-token",
                "--single-message",
                "hello from auth e2e",
                "--multi-first-message",
                "auth first turn",
                "--multi-second-message",
                "auth follow up",
                "--expected-single-response",
                "echo(turn=1): hello from auth e2e",
                "--expected-multi-first-response",
                "echo(turn=1): auth first turn",
                "--expected-multi-second-response",
                "echo(turn=2): auth follow up",
            ],
            cwd=os.getcwd(),
            env=env,
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        assert result.returncode == 0, f"stdout={result.stdout}\nstderr={result.stderr}"
        assert "agent_card_url:" in result.stdout
        assert "single_turn: ok" in result.stdout
        assert "multi_turn: ok" in result.stdout
        assert "a2a smoke test passed" in result.stdout
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=5)
