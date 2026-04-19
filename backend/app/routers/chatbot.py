"""
AI Chatbot router — Gemini-powered financial assistant.
Uses function-calling so the model can query financial data tools.
"""

import json
import traceback
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import List, Optional

from app.config import settings
from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.services.chatbot_tools import TOOL_FUNCTIONS, TOOL_DECLARATIONS

router = APIRouter(prefix="/api/chat", tags=["chatbot"])

# ── Lazy-load the Gemini client ──────────────────────────────────────

_model = None


def _get_model():
    global _model
    if _model is not None:
        return _model

    api_key = settings.GEMINI_API_KEY
    if not api_key:
        raise HTTPException(status_code=503, detail="GEMINI_API_KEY not configured")

    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=api_key)

        # Build tool declarations
        function_declarations = []
        for decl in TOOL_DECLARATIONS:
            props = decl["parameters"].get("properties", {})
            schema_props = {}
            required_fields = decl["parameters"].get("required", [])
            for pname, pdef in props.items():
                ptype = pdef["type"].upper()
                schema_props[pname] = types.Schema(
                    type=ptype,
                    description=pdef.get("description", ""),
                )
            fn_decl = types.FunctionDeclaration(
                name=decl["name"],
                description=decl["description"],
                parameters=types.Schema(
                    type="OBJECT",
                    properties=schema_props,
                    required=required_fields,
                ) if schema_props else None,
            )
            function_declarations.append(fn_decl)

        tool = types.Tool(function_declarations=function_declarations)
        _model = {"client": client, "tool": tool}
        return _model
    except ImportError:
        raise HTTPException(status_code=503, detail="google-genai package not installed")
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Failed to initialise Gemini: {str(e)}")


SYSTEM_PROMPT = """You are a smart financial assistant embedded in a personal finance tracker application.
You have READ-ONLY access to the user's financial data through tools.

Your capabilities:
- Analyse account balances and cash flow
- Review loan positions (given & taken), interest, and outstanding amounts
- Break down expenses by category and check against budget limits
- Track money obligations — who owes and who is owed
- Monitor property deals and partnership investments
- Track beesi/chit-fund contributions and withdrawals
- Verify incoming money claims against existing debts
- Detect data quality issues and notify the user

Guidelines:
- Be conversational, warm, and concise — like a knowledgeable financial advisor
- Use ₹ (Indian Rupee) symbol for all amounts
- When showing financial data, format numbers with commas (e.g., ₹1,50,000)
- When asked about a specific person, use the contact lookup tool first
- If the user mentions incoming money from someone, validate it against records
- If you detect discrepancies or issues, proactively mention them
- For tables of data, use clean markdown tables
- If you're unsure about something, ask a clarifying question instead of guessing
- NEVER suggest or attempt to modify any data — you are read-only
- Keep responses focused and avoid unnecessary filler
- Today's date is important for calculating overdue items — use it contextually
- Use the Indian numbering system: lakhs and crores (not millions and billions)"""


# ── Request / Response models ────────────────────────────────────────

class ChatMessage(BaseModel):
    role: str  # "user" or "assistant"
    content: str


class ChatRequest(BaseModel):
    message: str
    history: List[ChatMessage] = []


class ChatResponse(BaseModel):
    reply: str
    tool_calls: Optional[List[str]] = None  # which tools were invoked (for debug)


# ── Main chat endpoint ──────────────────────────────────────────────

@router.post("", response_model=ChatResponse)
def chat(
    req: ChatRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    model_info = _get_model()
    client = model_info["client"]
    tool = model_info["tool"]

    from google.genai import types

    # Build conversation history
    contents = []
    for msg in req.history[-10:]:  # limit history to save tokens on free tier
        role = "user" if msg.role == "user" else "model"
        contents.append(types.Content(role=role, parts=[types.Part.from_text(text=msg.content)]))

    # Add current message
    contents.append(types.Content(role="user", parts=[types.Part.from_text(text=req.message)]))

    tools_used = []
    max_rounds = 5  # prevent infinite function-call loops

    try:
        for round_num in range(max_rounds):
            response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=contents,
                config=types.GenerateContentConfig(
                    system_instruction=SYSTEM_PROMPT,
                    tools=[tool],
                    temperature=0.7,
                ),
            )

            # Check if the model wants to call a function
            candidate = response.candidates[0]
            part = candidate.content.parts[0]

            if part.function_call:
                fc = part.function_call
                fn_name = fc.name
                fn_args = dict(fc.args) if fc.args else {}
                tools_used.append(fn_name)

                # Execute the tool
                if fn_name in TOOL_FUNCTIONS:
                    try:
                        tool_fn = TOOL_FUNCTIONS[fn_name]
                        result = tool_fn(db=db, user_id=current_user.id, **fn_args)
                    except Exception as e:
                        result = {"error": str(e)}
                else:
                    result = {"error": f"Unknown tool: {fn_name}"}

                # Feed the function call and result back into the conversation
                contents.append(candidate.content)
                contents.append(
                    types.Content(
                        role="user",
                        parts=[types.Part.from_function_response(
                            name=fn_name,
                            response=result,
                        )],
                    )
                )
                continue
            else:
                reply_text = part.text if part.text else "I couldn't generate a response. Please try again."
                return ChatResponse(reply=reply_text, tool_calls=tools_used if tools_used else None)

    except HTTPException:
        raise
    except Exception as e:
        err_str = str(e)
        # Friendly messages for common Gemini errors
        if "API_KEY_INVALID" in err_str or "API key not valid" in err_str:
            raise HTTPException(status_code=503, detail="Gemini API key is invalid. Please check your GEMINI_API_KEY in .env and restart the backend.")
        if "RESOURCE_EXHAUSTED" in err_str or "quota" in err_str.lower():
            raise HTTPException(status_code=429, detail="Gemini API free-tier quota exhausted. Please wait and try again.")
        if "PERMISSION_DENIED" in err_str:
            raise HTTPException(status_code=503, detail="Gemini API key doesn't have access to Generative Language API. Enable it at aistudio.google.com.")
        raise HTTPException(status_code=502, detail=f"AI service error: {err_str[:200]}")

    return ChatResponse(
        reply="I gathered a lot of data but hit my processing limit. Could you ask a more specific question?",
        tool_calls=tools_used,
    )
