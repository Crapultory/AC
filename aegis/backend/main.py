"""Standalone Aegis CLI entrypoint."""

from __future__ import annotations

if __package__ in {None, ""}:
    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import argparse

from aegis.backend import server


def configure_aegis_parser(parser: argparse.ArgumentParser) -> argparse.ArgumentParser:
    """Attach Aegis arguments to an existing parser."""
    parser.add_argument("--port", type=int, default=9130, help="Port (default 9130)")
    parser.add_argument("--host", default="127.0.0.1", help="Host (default 127.0.0.1)")
    parser.add_argument(
        "--no-open", action="store_true", help="Don't open browser automatically"
    )
    parser.add_argument(
        "--insecure",
        action="store_true",
        help="Allow binding to non-localhost (DANGEROUS: exposes APIs on the network)",
    )
    return parser


def build_parser() -> argparse.ArgumentParser:
    """Build a standalone Aegis parser for direct Python startup."""
    parser = argparse.ArgumentParser(
        prog="aegis",
        description="Launch the Aegis backend service",
    )
    configure_aegis_parser(parser)
    parser.set_defaults(func=cmd_aegis)
    return parser


def cmd_aegis(args: argparse.Namespace) -> None:
    """Run the standalone Aegis backend server."""
    server.start_server(
        host=args.host,
        port=args.port,
        open_browser=not args.no_open,
        allow_public=args.insecure,
    )


def main(argv: list[str] | None = None) -> int:
    """Parse arguments and dispatch to the standalone Aegis backend."""
    parser = build_parser()
    args = parser.parse_args(argv)
    args.func(args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
