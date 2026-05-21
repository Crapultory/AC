"""Slack Block Kit tool -- send, update, delete rich interactive messages.

Provides the agent with the ability to post arbitrary Slack Block Kit
cards when running on the Slack gateway. Uses the live gateway adapter's
send_blocks / update_blocks methods.

Only included in the hermes-slack toolset, so it has zero cost for users
on other platforms.
"""

import json
import logging
import os
from typing import Any, Dict

from tools.registry import registry

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_slack_adapter():
    """Get the live Slack adapter from the gateway runner."""
    try:
        from gateway.run import _gateway_runner_ref
        from gateway.config import Platform
        runner = _gateway_runner_ref()
        if runner is None:
            return None
        return runner.adapters.get(Platform.SLACK)
    except Exception:
        return None


def check_slack_block_kit_requirements() -> bool:
    """Tool is available only when a Slack bot token is configured."""
    return bool(os.getenv("SLACK_BOT_TOKEN", "").strip())


# ---------------------------------------------------------------------------
# Action handlers
# ---------------------------------------------------------------------------

async def _handle_send_blocks(adapter, args: Dict[str, Any]) -> str:
    channel_id = args.get("channel_id", "")
    blocks = args.get("blocks")
    text = args.get("text", "")
    thread_ts = args.get("thread_ts")

    if not blocks:
        return json.dumps({"error": "blocks is required for send_blocks"})
    if not text:
        return json.dumps({"error": "text (fallback) is required for send_blocks"})

    metadata = {"thread_id": thread_ts} if thread_ts else None
    result = await adapter.send_blocks(
        channel_id,
        text=text,
        blocks=blocks,
        metadata=metadata,
    )
    if result.success:
        return json.dumps({"success": True, "message_id": result.message_id})
    return json.dumps({"error": result.error})


async def _handle_update_blocks(adapter, args: Dict[str, Any]) -> str:
    channel_id = args.get("channel_id", "")
    message_id = args.get("message_id", "")
    blocks = args.get("blocks")
    text = args.get("text", "")

    if not message_id:
        return json.dumps({"error": "message_id is required for update_blocks"})
    if not blocks:
        return json.dumps({"error": "blocks is required for update_blocks"})
    if not text:
        return json.dumps({"error": "text (fallback) is required for update_blocks"})

    result = await adapter.update_blocks(
        channel_id,
        message_id,
        text=text,
        blocks=blocks,
    )
    if result.success:
        return json.dumps({"success": True, "message_id": result.message_id})
    return json.dumps({"error": result.error})


async def _handle_delete_message(adapter, args: Dict[str, Any]) -> str:
    channel_id = args.get("channel_id", "")
    message_id = args.get("message_id", "")

    if not message_id:
        return json.dumps({"error": "message_id is required for delete_message"})

    try:
        client = adapter._get_client(channel_id)
        if client is None:
            return json.dumps({"error": "No Slack client available for this channel"})
        await client.chat_delete(channel=channel_id, ts=message_id)
        return json.dumps({"success": True})
    except Exception as e:
        return json.dumps({"error": f"Delete failed: {e}"})


def _handle_get_interactions(adapter, args: Dict[str, Any]) -> str:
    message_id = args.get("message_id", "")
    interactions = adapter.get_block_kit_interactions(message_id)
    return json.dumps({"interactions": interactions, "count": len(interactions)})


# ---------------------------------------------------------------------------
# Main handler
# ---------------------------------------------------------------------------

async def slack_block_kit_handler(args: Dict[str, Any], **kw) -> str:
    """Handle slack_block_kit tool calls."""
    action = args.get("action", "")
    channel_id = args.get("channel_id", "")

    if not action:
        return json.dumps({"error": "action is required"})
    if not channel_id and action != "get_interactions":
        return json.dumps({"error": "channel_id is required"})

    adapter = _get_slack_adapter()
    if adapter is None:
        return json.dumps({
            "error": "Slack adapter not available (gateway not running or Slack not connected)"
        })

    if action == "send_blocks":
        return await _handle_send_blocks(adapter, args)
    elif action == "update_blocks":
        return await _handle_update_blocks(adapter, args)
    elif action == "delete_message":
        return await _handle_delete_message(adapter, args)
    elif action == "get_interactions":
        return _handle_get_interactions(adapter, args)
    else:
        return json.dumps({
            "error": f"Unknown action: {action}",
            "available_actions": ["send_blocks", "update_blocks", "delete_message", "get_interactions"],
        })


# ---------------------------------------------------------------------------
# Tool registration
# ---------------------------------------------------------------------------

_SCHEMA = {
    "name": "slack_block_kit",
    "description": (
        "Send, update, or delete Slack Block Kit messages and query user interactions. "
        "Use this to send rich interactive cards with buttons, selects, sections, images, "
        "and other Block Kit elements to Slack channels."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["send_blocks", "update_blocks", "delete_message", "get_interactions"],
                "description": "The action to perform.",
            },
            "channel_id": {
                "type": "string",
                "description": "Slack channel/conversation ID (C..., G..., D...).",
            },
            "blocks": {
                "type": "array",
                "description": (
                    "Block Kit blocks array. Required for send_blocks and update_blocks. "
                    "Each element is a Block Kit block object (section, actions, divider, image, etc.)."
                ),
                "items": {"type": "object"},
            },
            "text": {
                "type": "string",
                "description": "Fallback plain text shown in notifications and accessibility. Required for send_blocks and update_blocks.",
            },
            "thread_ts": {
                "type": "string",
                "description": "Thread timestamp to post the message as a threaded reply (for send_blocks).",
            },
            "message_id": {
                "type": "string",
                "description": "Message timestamp (ts) of an existing message. Required for update_blocks, delete_message, and get_interactions.",
            },
        },
        "required": ["action", "channel_id"],
    },
}

registry.register(
    name="slack_block_kit",
    toolset="slack_block_kit",
    schema=_SCHEMA,
    handler=slack_block_kit_handler,
    check_fn=check_slack_block_kit_requirements,
    requires_env=["SLACK_BOT_TOKEN"],
    is_async=True,
    description="Send, update, or delete Slack Block Kit messages and query interactions",
    emoji="\U0001f9f1",
)
