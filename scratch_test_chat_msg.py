import asyncio
from livekit.agents import AgentSession, Agent, TurnHandlingOptions
from livekit.agents import llm
from unittest.mock import MagicMock

async def main():
    try:
        session = AgentSession(
            vad=MagicMock(), stt=MagicMock(), llm=MagicMock(), tts=MagicMock(), turn_handling=TurnHandlingOptions()
        )
        ctx = llm.ChatContext()
        ctx.messages().append(llm.ChatMessage(role="user", content="hello"))
        ctx.messages().append(llm.ChatMessage(role="system", content="sys msg"))
        for m in ctx.messages():
            print(f"role={m.role} (type={type(m.role)}) content={m.content}")
    except Exception as e:
        print("error:", e)

if __name__ == "__main__":
    asyncio.run(main())
