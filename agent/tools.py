"""Web search for NextBot and the report agents, through Brave's LLM Context API.

The endpoint returns pre-extracted passages per page (grounding.generic),
already sized for a model, plus a sources map with each page's age. Only
the passages, title, URL and date go back to the model: the raw response
repeats every source and runs to ~40 KB.

Brave charges per search, not for what comes back, so the model may set only
how much one search returns: `maximum_number_of_urls` (pages) and
`maximum_number_of_tokens` (text). A bigger one beats a second paid search.
Operators such as `site:` work in the query itself. Everything else Brave
offers (freshness, country, language, location, ...) is left at Brave's
default.

The model's values are forgiving, not strict: a number out of range is
clamped, and an option that is not offered is ignored (the model copies the
arguments of earlier calls in a thread), so a slip does not cost a tool call.
"""

import re

import httpx
from config import settings
from langchain.tools import ToolException
from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field, ValidationInfo, field_validator
from utils.logger import logger

from agent.progress import emit_progress

BRAVE_LLM_CONTEXT_URL = "https://api.search.brave.com/res/v1/llm/context"

WEB_SEARCH_TOOL_NAME = "search_web"

# What a search returns when the model asks for nothing more.
DEFAULT_URLS = 5
DEFAULT_TOKENS = 4096
# The search hits Brave looks at before it picks the best pages (never fewer than the pages asked for).
HITS_WEIGHED = 8

# The two numbers the model may set. Brave allows 50 pages; a search never needs that many.
# A value outside the range is clamped, not refused.
RANGES = {"maximum_number_of_urls": (1, 10), "maximum_number_of_tokens": (1024, 8192)}
MAX_QUERY_CHARS = 600
MAX_QUERY_WORDS = 75

_SITE_OPERATOR = re.compile(r"\bsite:", re.IGNORECASE)


class SearchArgs(BaseModel):
    query: str = Field(
        description=(
            "The search. Be specific, and add the current year when recency matters, e.g. "
            '"vLLM latest release 2026". Operators work: site:github.com, "exact phrase", -word.'
        )
    )
    maximum_number_of_urls: int | None = Field(
        default=None,
        ge=1,
        le=10,
        description="Most pages to return. Default 5. Raise it to compare several sources or countries, lower it for one fact, eg: conversion rate finder",
    )
    maximum_number_of_tokens: int | None = Field(
        default=None,
        ge=1024,
        le=8192,
        description="Total text to return. Default 4096. Raise it (up to 8192) when one search should cover a lot, instead of searching twice. 2048 is enough for one fact.",
    )

    @field_validator(*RANGES, mode="before")
    @classmethod
    def _clamp(cls, value, info: ValidationInfo):
        try:
            number = int(value)
        except (TypeError, ValueError):
            return value
        low, high = RANGES[info.field_name]
        return min(max(number, low), high)


DESCRIPTION = (
    "Search the web for current information and get passages from the best pages. "
    "Use it for anything that has to be current or that you are not sure about: news, releases, "
    "prices, people in office, exchange rates. "
    "Only `query` is needed. `maximum_number_of_urls` and `maximum_number_of_tokens` set how many pages and how much text "
    "come back: ask for more when one search should cover a lot, so you do not have to search twice. "
    "`site:` in `query` limits results to one source. "
    'Returns {"results": [{"title", "url", "published", "content"}]} -- '
    "`content` is extracted text (it can include Markdown tables) from that page."
)


def _query(text: str) -> str:
    words = text.split()
    query = " ".join(words[:MAX_QUERY_WORDS])[:MAX_QUERY_CHARS].strip()
    if not query:
        raise ToolException("`query` is empty. Say what to search for.")
    return query


def build_params(args: SearchArgs) -> dict:
    """The query string for Brave. Everything not set here is Brave's own default."""
    urls = args.maximum_number_of_urls or DEFAULT_URLS
    return {
        "q": _query(args.query),
        # Weighing fewer hits than pages asked for would quietly cap the answer.
        "count": max(HITS_WEIGHED, urls),
        "maximum_number_of_urls": urls,
        "maximum_number_of_tokens": args.maximum_number_of_tokens or DEFAULT_TOKENS,
    }


_client: httpx.AsyncClient | None = None


def _http() -> httpx.AsyncClient:
    global _client
    if _client is None:
        # Brave asks for 30 seconds: a big token budget takes longer to extract.
        _client = httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=5.0))
    return _client


def _page_date(source: dict) -> str | None:
    # `age` is e.g. ["Friday, October 16, 2026", "2026-10-16", "8 days ago", "2026-10-16T13:45:02Z"]
    age = source.get("age") or []
    return age[1] if len(age) > 1 else (age[0] if age else None)


def compact_results(data: dict) -> list[dict]:
    """The passages the model reads, one entry per page."""
    sources = data.get("sources") or {}
    results = []
    for item in (data.get("grounding") or {}).get("generic") or []:
        url = item.get("url")
        content = "\n\n".join(s for s in item.get("snippets") or [] if s).strip()
        if not url or not content:
            continue
        entry = {"title": item.get("title") or "", "url": url, "content": content}
        date = _page_date(sources.get(url) or {})
        if date:
            entry["published"] = date
        results.append(entry)
    return results


def _empty_note(query: str) -> str:
    """Said when nothing matched, so the model rephrases instead of repeating itself."""
    if _SITE_OPERATOR.search(query):
        return "No pages matched. Try without the `site:` part, or different wording."
    return "No pages matched. Try different wording."


async def _search_web(**fields) -> dict:
    if not settings.BRAVE_SEARCH_API_KEY:
        raise ToolException("Web search is not configured.")

    params = build_params(SearchArgs(**fields))
    headers = {
        "X-Subscription-Token": settings.BRAVE_SEARCH_API_KEY,
        "Accept": "application/json",
    }

    emit_progress({"message": f"Searching the web for “{params['q']}”"})

    try:
        response = await _http().get(
            BRAVE_LLM_CONTEXT_URL, headers=headers, params=params
        )
        response.raise_for_status()
        results = compact_results(response.json())
    except Exception as e:
        logger.error(f"Brave search failed for query '{params['q']}': {e}")
        raise ToolException("Search tool failed.") from e

    emit_progress(
        {
            "message": f"Read {len(results)} page(s)",
            "sources": [{"title": r["title"], "url": r["url"]} for r in results],
        }
    )

    out: dict = {"results": results}
    if not results:
        out["note"] = _empty_note(params["q"])
    return out


search_web = StructuredTool.from_function(
    coroutine=_search_web,
    name=WEB_SEARCH_TOOL_NAME,
    description=DESCRIPTION,
    args_schema=SearchArgs,
    # A failed search goes back to the model as text instead of crashing the run.
    handle_tool_error=True,
)
