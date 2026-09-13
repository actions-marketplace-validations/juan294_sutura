import asyncio
from typing import List, Sequence, Tuple


async def _load(name: str, delay: float) -> str:
    await asyncio.sleep(delay)
    return name


async def load_all(requests: Sequence[Tuple[str, float]]) -> List[str]:
    return list(await asyncio.gather(*(_load(name, delay) for name, delay in requests)))
