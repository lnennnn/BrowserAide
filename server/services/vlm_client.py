"""VLM client for OpenAI-compatible APIs."""

import asyncio
import random
import time
from typing import List, Dict, AsyncGenerator, Callable, Optional
from openai import AsyncOpenAI, APIError, RateLimitError
from core.config import Config


class VLMClient:
    """Async client for VLM inference."""


    _shared_client: Optional[AsyncOpenAI] = None
    _request_gate: Optional[asyncio.Semaphore] = None
    _throttle_lock: Optional[asyncio.Lock] = None
    _last_request_at: float = 0.0

    def __init__(
        self,
        api_key: str = None,
        base_url: str = None,
        model: str = None
    ):
        """Init."""
        self.api_key = api_key or Config.VLM_API_KEY
        self.base_url = base_url or Config.VLM_BASE_URL
        self.model = model or Config.VLM_MODEL


        has_runtime_override = any([api_key, base_url, model])
        if has_runtime_override:
            self.client = AsyncOpenAI(
                api_key=self.api_key,
                base_url=self.base_url,
                timeout=60.0,
                max_retries=2
            )
        elif VLMClient._shared_client is None:
            VLMClient._shared_client = AsyncOpenAI(
                api_key=self.api_key,
                base_url=self.base_url,
                timeout=60.0,
                max_retries=2
            )
        if VLMClient._request_gate is None:
            VLMClient._request_gate = asyncio.Semaphore(max(1, Config.VLM_MAX_CONCURRENT))
        if VLMClient._throttle_lock is None:
            VLMClient._throttle_lock = asyncio.Lock()

        if not has_runtime_override:
            self.client = VLMClient._shared_client

    @staticmethod
    def _is_burst_error(error: Exception) -> bool:
        message = str(error).lower()
        return (
            isinstance(error, (RateLimitError, APIError))
            and (
                "request burst" in message
                or "slow down traffic growth" in message
                or "rate limit" in message
                or "too many requests" in message
            )
        )

    @staticmethod
    def _retry_delay_seconds(attempt: int) -> float:
        base = max(500, Config.VLM_BURST_RETRY_BASE_MS) / 1000.0
        jitter = random.uniform(0, 0.6)
        return base * (2 ** attempt) + jitter

    async def _respect_request_interval(self) -> None:
        async with VLMClient._throttle_lock:
            now = time.monotonic()
            min_interval = max(0, Config.VLM_MIN_REQUEST_INTERVAL_MS) / 1000.0
            wait_time = min_interval - (now - VLMClient._last_request_at)
            if wait_time > 0:
                await asyncio.sleep(wait_time)
            VLMClient._last_request_at = time.monotonic()

    async def _create_completion(self, messages: List[Dict], max_tokens: int, stream: bool):
        attempts = max(1, Config.VLM_BURST_RETRY_ATTEMPTS)
        async with VLMClient._request_gate:
            for attempt in range(attempts):
                await self._respect_request_interval()
                try:
                    return await self.client.chat.completions.create(
                        model=self.model,
                        messages=messages,
                        max_tokens=max_tokens or Config.VLM_MAX_TOKENS,
                        stream=stream
                    )
                except Exception as e:
                    if attempt >= attempts - 1 or not self._is_burst_error(e):
                        raise
                    delay = self._retry_delay_seconds(attempt)
                    print(
                        f"[VLMClient] Burst protection triggered, retrying in {delay:.1f}s "
                        f"(attempt {attempt + 1}/{attempts})"
                    )
                    await asyncio.sleep(delay)

    async def infer(
        self,
        messages: List[Dict],
        max_tokens: int = None
    ) -> str:
        """Infer."""
        response = await self._create_completion(messages, max_tokens, stream=False)
        return response.choices[0].message.content

    async def infer_streaming(
        self,
        messages: List[Dict],
        max_tokens: int = None,
        on_first_token: Callable[[float], None] = None,
        on_chunk: Callable[[str, str], None] = None
    ) -> str:
        """Infer streaming."""
        start_time = time.time()
        first_token_received = False
        accumulated_content = ""

        response = await self._create_completion(messages, max_tokens, stream=True)

        async for chunk in response:

            delta = chunk.choices[0].delta if chunk.choices else None
            if delta and delta.content:
                chunk_content = delta.content
                accumulated_content += chunk_content


                if not first_token_received:
                    first_token_received = True
                    ttft = (time.time() - start_time) * 1000
                    if on_first_token:
                        on_first_token(ttft)


                if on_chunk:
                    on_chunk(chunk_content, accumulated_content)

        return accumulated_content

    async def infer_streaming_generator(
        self,
        messages: List[Dict],
        max_tokens: int = None
    ) -> AsyncGenerator[Dict, None]:
        """Infer streaming generator."""
        start_time = time.time()
        first_token_received = False
        accumulated_content = ""

        yield {"type": "start", "timestamp": start_time}

        response = await self._create_completion(messages, max_tokens, stream=True)

        async for chunk in response:
            delta = chunk.choices[0].delta if chunk.choices else None
            if delta and delta.content:
                chunk_content = delta.content
                accumulated_content += chunk_content


                if not first_token_received:
                    first_token_received = True
                    ttft = (time.time() - start_time) * 1000
                    yield {"type": "first_token", "ttft_ms": ttft}


                yield {
                    "type": "chunk",
                    "content": chunk_content,
                    "accumulated": accumulated_content
                }


        ttlt = (time.time() - start_time) * 1000
        yield {
            "type": "complete",
            "content": accumulated_content,
            "ttlt_ms": ttlt
        }

    async def infer_with_metrics(
        self,
        messages: List[Dict],
        max_tokens: int = None,
        use_streaming: bool = True
    ) -> Dict:
        """Infer with metrics."""
        start_time = time.time()

        if use_streaming:
            ttft_ms = None

            def on_first_token(ttft):
                nonlocal ttft_ms
                ttft_ms = ttft

            content = await self.infer_streaming(
                messages,
                max_tokens,
                on_first_token=on_first_token
            )

            ttlt_ms = (time.time() - start_time) * 1000

            return {
                "content": content,
                "ttft_ms": ttft_ms or ttlt_ms,
                "ttlt_ms": ttlt_ms,
                "streaming": True
            }
        else:
            content = await self.infer(messages, max_tokens)
            ttlt_ms = (time.time() - start_time) * 1000

            return {
                "content": content,
                "ttft_ms": ttlt_ms,
                "ttlt_ms": ttlt_ms,
                "streaming": False
            }

    async def health_check(self) -> bool:
        """Health check."""
        try:

            await self.client.models.list()
            return True
        except Exception:
            return False

    async def test_connection(self) -> Dict:
        """Run a tiny completion to verify the configured endpoint and model."""
        response = await self._create_completion(
            messages=[{"role": "user", "content": "Reply with OK."}],
            max_tokens=8,
            stream=False
        )
        content = response.choices[0].message.content if response.choices else ""
        return {
            "ok": True,
            "model": self.model,
            "content": content,
        }
