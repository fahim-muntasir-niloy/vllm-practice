from langchain_openai import ChatOpenAI

llm = ChatOpenAI(
    base_url="http://localhost:8000/v1",
    api_key="not-needed",  # vLLM doesn't check the key unless you configure one
    model="LiquidAI/LFM2.5-1.2B-Instruct",
)
print(llm.invoke("What is the capital of Bangladesh?").content)