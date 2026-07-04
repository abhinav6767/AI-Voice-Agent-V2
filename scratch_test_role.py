from livekit.agents import llm
msg = llm.ChatMessage(role=llm.ChatRole.SYSTEM, content="hello")
print("Role:", msg.role, "type:", type(msg.role))
print("Content:", msg.content, "type:", type(msg.content))
if msg.role == "system":
    print("msg.role == 'system' is True!")
else:
    print("msg.role == 'system' is False!")
