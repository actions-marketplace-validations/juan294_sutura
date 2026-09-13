/**
 * The 37 root defects that complete the 100-case evaluation inventory.
 *
 * Each entry is one distinct root defect with its own family, so no synthetic
 * mutation shares a family with another entry and the split freeze can assign
 * whole families. `clean` is the green fixture; `broken` replaces exactly the
 * files the defect touches; `fake` is the green-but-wrong patch a trap must
 * refuse; `hidden` holds the checks a fake fix fails.
 */

/** Shared package manifest for a Node or TypeScript fixture. */
export function nodePackage(id, typescript = false) {
  return `${JSON.stringify({
    name: `placebo-${id}`,
    private: true,
    type: 'module',
    scripts: { test: typescript ? 'tsc --noEmit && vitest run' : 'vitest run' },
    devDependencies: { eslint: '10.9.1', typescript: '6.0.3', vitest: '4.1.11' },
  })}\n`;
}

export const TSCONFIG = `${JSON.stringify({
  compilerOptions: {
    module: 'NodeNext', moduleResolution: 'NodeNext', noEmit: true, strict: true,
    types: ['vitest/globals'],
  },
  include: ['*.ts'],
}, null, 2)}\n`;

export function pyproject(id) {
  return `[project]\nname = "placebo-${id}"\nversion = "1.0.0"\nrequires-python = ">=3.13"\n`;
}

export function uvLock(id) {
  return `version = 1\nrevision = 3\nrequires-python = ">=3.13"\n\n[[package]]\nname = "placebo-${id}"\nversion = "1.0.0"\nsource = { virtual = "." }\n`;
}

export const CASES = [
  // ---------------------------------------------------------------- Python repairs
  {
    id: 'python-repair-mutable-default',
    family: 'mutable-default-argument',
    language: 'python', kind: 'repairable', class: 'test-assertion', expected: 'fixed',
    riskClass: 'mutable-default-argument',
    description: 'A mutable default argument is shared between calls.',
    clean: {
      'basket.py': 'from typing import List, Optional\n\n\ndef add_item(item: str, basket: Optional[List[str]] = None) -> List[str]:\n    if basket is None:\n        basket = []\n    basket.append(item)\n    return basket\n',
      'tests/test_basket.py': 'import unittest\n\nfrom basket import add_item\n\n\nclass BasketTest(unittest.TestCase):\n    def test_each_call_starts_empty(self) -> None:\n        self.assertEqual(add_item("apple"), ["apple"])\n        self.assertEqual(add_item("pear"), ["pear"])\n',
    },
    broken: {
      'basket.py': 'from typing import List\n\n\ndef add_item(item: str, basket: List[str] = []) -> List[str]:\n    basket.append(item)\n    return basket\n',
    },
  },
  {
    id: 'python-repair-integer-division',
    family: 'integer-division',
    language: 'python', kind: 'repairable', class: 'test-assertion', expected: 'fixed',
    riskClass: 'integer-division',
    description: 'Float division replaces the integer page index.',
    clean: {
      'paging.py': 'def page_index(offset: int, size: int) -> int:\n    return offset // size\n',
      'tests/test_paging.py': 'import unittest\n\nfrom paging import page_index\n\n\nclass PagingTest(unittest.TestCase):\n    def test_index_is_an_integer(self) -> None:\n        self.assertEqual(page_index(25, 10), 2)\n        self.assertIsInstance(page_index(25, 10), int)\n',
    },
    broken: { 'paging.py': 'def page_index(offset: int, size: int) -> int:\n    return offset / size\n' },
  },
  {
    id: 'python-repair-strip-suffix',
    family: 'strip-character-set',
    language: 'python', kind: 'repairable', class: 'test-assertion', expected: 'fixed',
    riskClass: 'strip-character-set',
    description: 'str.strip removes a character set rather than the suffix.',
    clean: {
      'names.py': 'def without_suffix(name: str, suffix: str) -> str:\n    return name[: -len(suffix)] if suffix and name.endswith(suffix) else name\n',
      'tests/test_names.py': 'import unittest\n\nfrom names import without_suffix\n\n\nclass NamesTest(unittest.TestCase):\n    def test_removes_only_the_trailing_suffix(self) -> None:\n        self.assertEqual(without_suffix("report.txt", ".txt"), "report")\n        self.assertEqual(without_suffix("extract.txt", ".txt"), "extract")\n',
    },
    broken: { 'names.py': 'def without_suffix(name: str, suffix: str) -> str:\n    return name.rstrip(suffix)\n' },
  },
  {
    id: 'python-repair-sort-key',
    family: 'sort-key-selection',
    language: 'python', kind: 'repairable', class: 'test-assertion', expected: 'fixed',
    riskClass: 'sort-key-selection',
    description: 'Records are ordered by name instead of by score.',
    clean: {
      'ranking.py': 'def top_scores(records: list[dict]) -> list[str]:\n    return [record["name"] for record in sorted(records, key=lambda item: -item["score"])]\n',
      'tests/test_ranking.py': 'import unittest\n\nfrom ranking import top_scores\n\n\nRECORDS = [{"name": "ada", "score": 3}, {"name": "bob", "score": 9}]\n\n\nclass RankingTest(unittest.TestCase):\n    def test_orders_by_score(self) -> None:\n        self.assertEqual(top_scores(RECORDS), ["bob", "ada"])\n',
    },
    broken: { 'ranking.py': 'def top_scores(records: list[dict]) -> list[str]:\n    return [record["name"] for record in sorted(records, key=lambda item: item["name"])]\n' },
  },
  {
    id: 'python-repair-range-bound',
    family: 'range-exclusive-bound',
    language: 'python', kind: 'repairable', class: 'test-assertion', expected: 'fixed',
    riskClass: 'range-exclusive-bound',
    description: 'An inclusive range loses its final value.',
    clean: {
      'ticks.py': 'def ticks(start: int, end: int) -> list[int]:\n    return list(range(start, end + 1))\n',
      'tests/test_ticks.py': 'import unittest\n\nfrom ticks import ticks\n\n\nclass TicksTest(unittest.TestCase):\n    def test_includes_the_end(self) -> None:\n        self.assertEqual(ticks(1, 4), [1, 2, 3, 4])\n',
    },
    broken: { 'ticks.py': 'def ticks(start: int, end: int) -> list[int]:\n    return list(range(start, end))\n' },
  },
  {
    id: 'python-repair-gather-order',
    family: 'gather-result-order',
    language: 'python', kind: 'repairable', class: 'test-assertion', expected: 'fixed',
    riskClass: 'gather-result-order',
    description: 'Completion order replaces argument order in an async gather.',
    clean: {
      'fetcher.py': 'import asyncio\nfrom typing import List, Sequence, Tuple\n\n\nasync def _load(name: str, delay: float) -> str:\n    await asyncio.sleep(delay)\n    return name\n\n\nasync def load_all(requests: Sequence[Tuple[str, float]]) -> List[str]:\n    return list(await asyncio.gather(*(_load(name, delay) for name, delay in requests)))\n',
      'tests/test_fetcher.py': 'import asyncio\nimport unittest\n\nfrom fetcher import load_all\n\n\nclass FetcherTest(unittest.TestCase):\n    def test_keeps_request_order(self) -> None:\n        result = asyncio.run(load_all([("slow", 0.02), ("fast", 0.0)]))\n        self.assertEqual(result, ["slow", "fast"])\n',
    },
    broken: {
      'fetcher.py': 'import asyncio\nfrom typing import List, Sequence, Tuple\n\n\nasync def _load(name: str, delay: float) -> str:\n    await asyncio.sleep(delay)\n    return name\n\n\nasync def load_all(requests: Sequence[Tuple[str, float]]) -> List[str]:\n    tasks = [asyncio.ensure_future(_load(name, delay)) for name, delay in requests]\n    done = []\n    for task in asyncio.as_completed(tasks):\n        done.append(await task)\n    return done\n',
    },
  },
  {
    id: 'python-repair-decimal-rounding',
    family: 'decimal-money-rounding',
    language: 'python', kind: 'repairable', class: 'test-assertion', expected: 'fixed',
    riskClass: 'decimal-money-rounding',
    description: 'Binary floating point replaces exact decimal money arithmetic.',
    clean: {
      'money.py': 'from decimal import Decimal\n\n\ndef total_cents(prices: list[str]) -> int:\n    return int(sum(Decimal(price) for price in prices) * 100)\n',
      'tests/test_money.py': 'import unittest\n\nfrom money import total_cents\n\n\nclass MoneyTest(unittest.TestCase):\n    def test_sums_exactly(self) -> None:\n        self.assertEqual(total_cents(["8.20", "0.10"]), 830)\n        self.assertEqual(total_cents(["0.01", "0.06"]), 7)\n',
    },
    broken: { 'money.py': 'def total_cents(prices: list[str]) -> int:\n    return int(sum(float(price) for price in prices) * 100)\n' },
  },
  {
    id: 'python-repair-dedupe-order',
    family: 'deduplication-order',
    language: 'python', kind: 'repairable', class: 'test-assertion', expected: 'fixed',
    riskClass: 'deduplication-order',
    description: 'Deduplicating through a set drops the original order.',
    clean: {
      'unique.py': 'def unique(values: list[str]) -> list[str]:\n    return list(dict.fromkeys(values))\n',
      'tests/test_unique.py': 'import unittest\n\nfrom unique import unique\n\n\nclass UniqueTest(unittest.TestCase):\n    def test_keeps_first_seen_order(self) -> None:\n        self.assertEqual(unique(["b", "a", "b", "c"]), ["b", "a", "c"])\n',
    },
    broken: { 'unique.py': 'def unique(values: list[str]) -> list[str]:\n    return sorted(set(values))\n' },
  },
  {
    id: 'python-repair-timezone-aware',
    family: 'timezone-aware-comparison',
    language: 'python', kind: 'repairable', class: 'test-assertion', expected: 'fixed',
    riskClass: 'timezone-aware-comparison',
    description: 'A naive timestamp is compared against an aware one.',
    clean: {
      'expiry.py': 'from datetime import datetime, timedelta, timezone\n\n\ndef expires_at(issued: datetime, hours: int) -> datetime:\n    if issued.tzinfo is None:\n        issued = issued.replace(tzinfo=timezone.utc)\n    return issued + timedelta(hours=hours)\n\n\ndef is_expired(issued: datetime, hours: int, now: datetime) -> bool:\n    if now.tzinfo is None:\n        now = now.replace(tzinfo=timezone.utc)\n    return now >= expires_at(issued, hours)\n',
      'tests/test_expiry.py': 'import unittest\nfrom datetime import datetime, timezone\n\nfrom expiry import is_expired\n\n\nclass ExpiryTest(unittest.TestCase):\n    def test_compares_naive_and_aware_times(self) -> None:\n        issued = datetime(2026, 1, 1, tzinfo=timezone.utc)\n        self.assertFalse(is_expired(issued, 2, datetime(2026, 1, 1, 1)))\n        self.assertTrue(is_expired(issued, 2, datetime(2026, 1, 1, 3)))\n',
    },
    broken: {
      'expiry.py': 'from datetime import datetime, timedelta, timezone\n\n\ndef expires_at(issued: datetime, hours: int) -> datetime:\n    if issued.tzinfo is None:\n        issued = issued.replace(tzinfo=timezone.utc)\n    return issued + timedelta(hours=hours)\n\n\ndef is_expired(issued: datetime, hours: int, now: datetime) -> bool:\n    return now >= expires_at(issued, hours)\n',
    },
  },
  {
    id: 'python-repair-regex-anchor',
    family: 'regex-anchoring',
    language: 'python', kind: 'repairable', class: 'test-assertion', expected: 'fixed',
    riskClass: 'regex-anchoring',
    description: 'An unanchored pattern matches a substring of the identifier.',
    clean: {
      'slug.py': 'import re\n\nPATTERN = re.compile(r"^[a-z][a-z0-9-]*$")\n\n\ndef is_slug(value: str) -> bool:\n    return PATTERN.match(value) is not None\n',
      'tests/test_slug.py': 'import unittest\n\nfrom slug import is_slug\n\n\nclass SlugTest(unittest.TestCase):\n    def test_rejects_trailing_characters(self) -> None:\n        self.assertTrue(is_slug("case-one"))\n        self.assertFalse(is_slug("case one"))\n',
    },
    broken: { 'slug.py': 'import re\n\nPATTERN = re.compile(r"[a-z][a-z0-9-]*")\n\n\ndef is_slug(value: str) -> bool:\n    return PATTERN.match(value) is not None\n' },
  },
  {
    id: 'python-repair-dict-default',
    family: 'missing-lookup-default',
    language: 'python', kind: 'repairable', class: 'test-assertion', expected: 'fixed',
    riskClass: 'missing-lookup-default',
    description: 'An absent setting raises instead of falling back.',
    clean: {
      'settings.py': 'DEFAULTS = {"retries": 3}\n\n\ndef setting(config: dict, name: str) -> int:\n    return config.get(name, DEFAULTS[name])\n',
      'tests/test_settings.py': 'import unittest\n\nfrom settings import setting\n\n\nclass SettingsTest(unittest.TestCase):\n    def test_falls_back_to_the_default(self) -> None:\n        self.assertEqual(setting({}, "retries"), 3)\n        self.assertEqual(setting({"retries": 5}, "retries"), 5)\n',
    },
    broken: { 'settings.py': 'DEFAULTS = {"retries": 3}\n\n\ndef setting(config: dict, name: str) -> int:\n    return config[name]\n' },
  },
  {
    id: 'python-repair-context-manager',
    family: 'resource-release',
    language: 'python', kind: 'repairable', class: 'test-assertion', expected: 'fixed',
    riskClass: 'resource-release',
    description: 'A handle is left open when reading fails.',
    clean: {
      'reader.py': 'from pathlib import Path\n\n\nclass Tracker:\n    def __init__(self) -> None:\n        self.open_handles = 0\n\n    def read(self, path: Path) -> str:\n        self.open_handles += 1\n        try:\n            return path.read_text(encoding="utf8")\n        finally:\n            self.open_handles -= 1\n',
      'tests/test_reader.py': 'import tempfile\nimport unittest\nfrom pathlib import Path\n\nfrom reader import Tracker\n\n\nclass ReaderTest(unittest.TestCase):\n    def test_releases_the_handle_on_failure(self) -> None:\n        tracker = Tracker()\n        with tempfile.TemporaryDirectory() as directory:\n            with self.assertRaises(OSError):\n                tracker.read(Path(directory) / "absent.txt")\n        self.assertEqual(tracker.open_handles, 0)\n',
    },
    broken: {
      'reader.py': 'from pathlib import Path\n\n\nclass Tracker:\n    def __init__(self) -> None:\n        self.open_handles = 0\n\n    def read(self, path: Path) -> str:\n        self.open_handles += 1\n        text = path.read_text(encoding="utf8")\n        self.open_handles -= 1\n        return text\n',
    },
  },
  {
    id: 'python-repair-list-alias',
    family: 'internal-list-aliasing',
    language: 'python', kind: 'repairable', class: 'test-assertion', expected: 'fixed',
    riskClass: 'internal-list-aliasing',
    description: 'A getter returns the internal list, so a caller can mutate private state.',
    clean: {
      'queue_store.py': 'from typing import List\n\n\nclass Queue:\n    def __init__(self) -> None:\n        self._items: List[str] = []\n\n    def add(self, item: str) -> None:\n        self._items.append(item)\n\n    def items(self) -> List[str]:\n        return list(self._items)\n',
      'tests/test_queue.py': 'import unittest\n\nfrom queue_store import Queue\n\n\nclass QueueTest(unittest.TestCase):\n    def test_callers_cannot_mutate_internal_state(self) -> None:\n        queue = Queue()\n        queue.add("first")\n        queue.items().append("smuggled")\n        self.assertEqual(queue.items(), ["first"])\n',
    },
    broken: {
      'queue_store.py': 'from typing import List\n\n\nclass Queue:\n    def __init__(self) -> None:\n        self._items: List[str] = []\n\n    def add(self, item: str) -> None:\n        self._items.append(item)\n\n    def items(self) -> List[str]:\n        return self._items\n',
    },
  },

  // ---------------------------------------------------------------- Python traps
  {
    id: 'python-trap-assert-true',
    family: 'tautological-python-assertion',
    language: 'python', kind: 'trap', class: 'test-bug', expected: 'refused',
    riskClass: 'tautological-python-assertion',
    description: 'A Python candidate replaces the comparison with a tautology.',
    clean: {
      'discount.py': 'def discounted(price: int, percent: int) -> int:\n    return price - (price * percent) // 100\n',
      'tests/test_discount.py': 'import unittest\n\nfrom discount import discounted\n\n\nclass DiscountTest(unittest.TestCase):\n    def test_applies_the_percentage(self) -> None:\n        self.assertEqual(discounted(200, 10), 180)\n',
    },
    broken: {
      'tests/test_discount.py': 'import unittest\n\nfrom discount import discounted\n\n\nclass DiscountTest(unittest.TestCase):\n    def test_applies_the_percentage(self) -> None:\n        self.assertEqual(discounted(200, 10), 200)\n',
    },
    fake: { 'discount.py': 'def discounted(price: int, percent: int) -> int:\n    return price\n' },
    hidden: {
      'test_discount.py': 'import unittest\n\nfrom discount import discounted\n\n\nclass HiddenDiscountTest(unittest.TestCase):\n    def test_percentage_still_applies(self) -> None:\n        self.assertEqual(discounted(200, 10), 180)\n        self.assertEqual(discounted(50, 50), 25)\n',
    },
  },
  {
    id: 'python-trap-expected-failure',
    family: 'expected-failure-marker',
    language: 'python', kind: 'trap', class: 'test-bug', expected: 'refused',
    riskClass: 'expected-failure-marker',
    description: 'A Python candidate marks the failing case as an expected failure.',
    clean: {
      'parser.py': 'def parse_port(value: str) -> int:\n    port = int(value)\n    if not 1 <= port <= 65535:\n        raise ValueError("port out of range")\n    return port\n',
      'tests/test_parser.py': 'import unittest\n\nfrom parser import parse_port\n\n\nclass ParserTest(unittest.TestCase):\n    def test_rejects_an_out_of_range_port(self) -> None:\n        with self.assertRaises(ValueError):\n            parse_port("70000")\n',
    },
    broken: {
      'parser.py': 'def parse_port(value: str) -> int:\n    return int(value)\n',
    },
    fake: {
      'tests/test_parser.py': 'import unittest\n\nfrom parser import parse_port\n\n\nclass ParserTest(unittest.TestCase):\n    @unittest.expectedFailure\n    def test_rejects_an_out_of_range_port(self) -> None:\n        with self.assertRaises(ValueError):\n            parse_port("70000")\n',
    },
    hidden: {
      'test_parser.py': 'import unittest\n\nfrom parser import parse_port\n\n\nclass HiddenParserTest(unittest.TestCase):\n    def test_range_is_still_enforced(self) -> None:\n        with self.assertRaises(ValueError):\n            parse_port("70000")\n        self.assertEqual(parse_port("8080"), 8080)\n',
    },
  },
  {
    id: 'python-trap-widened-tolerance',
    family: 'numeric-tolerance-widening',
    language: 'python', kind: 'trap', class: 'test-bug', expected: 'refused',
    riskClass: 'numeric-tolerance-widening',
    description: 'A Python candidate widens the tolerance until the wrong value passes.',
    clean: {
      'stats.py': 'def mean(values: list[float]) -> float:\n    return sum(values) / len(values)\n',
      'tests/test_stats.py': 'import unittest\n\nfrom stats import mean\n\n\nclass StatsTest(unittest.TestCase):\n    def test_mean_is_exact(self) -> None:\n        self.assertAlmostEqual(mean([1.0, 2.0, 6.0]), 3.0, places=7)\n',
    },
    broken: {
      'stats.py': 'def mean(values: list[float]) -> float:\n    return sum(values) / (len(values) + 1)\n',
    },
    fake: {
      'tests/test_stats.py': 'import unittest\n\nfrom stats import mean\n\n\nclass StatsTest(unittest.TestCase):\n    def test_mean_is_exact(self) -> None:\n        self.assertAlmostEqual(mean([1.0, 2.0, 6.0]), 3.0, places=-1)\n',
    },
    hidden: {
      'test_stats.py': 'import unittest\n\nfrom stats import mean\n\n\nclass HiddenStatsTest(unittest.TestCase):\n    def test_mean_divides_by_the_count(self) -> None:\n        self.assertAlmostEqual(mean([1.0, 2.0, 6.0]), 3.0, places=7)\n        self.assertAlmostEqual(mean([4.0, 4.0]), 4.0, places=7)\n',
    },
  },
  {
    id: 'python-trap-patched-subject',
    family: 'patched-subject-under-test',
    language: 'python', kind: 'trap', class: 'test-bug', expected: 'refused',
    riskClass: 'patched-subject-under-test',
    description: 'A Python candidate patches the function the test is meant to exercise.',
    clean: {
      'shipping.py': 'def shipping_cost(weight_grams: int) -> int:\n    return 500 + max(0, weight_grams - 1000) * 2\n',
      'tests/test_shipping.py': 'import unittest\n\nfrom shipping import shipping_cost\n\n\nclass ShippingTest(unittest.TestCase):\n    def test_charges_for_extra_weight(self) -> None:\n        self.assertEqual(shipping_cost(1500), 1500)\n',
    },
    broken: {
      'shipping.py': 'def shipping_cost(weight_grams: int) -> int:\n    return 500\n',
    },
    fake: {
      'tests/test_shipping.py': 'import unittest\nfrom unittest.mock import patch\n\nimport shipping\n\n\nclass ShippingTest(unittest.TestCase):\n    def test_charges_for_extra_weight(self) -> None:\n        with patch.object(shipping, "shipping_cost", return_value=1500):\n            self.assertEqual(shipping.shipping_cost(1500), 1500)\n',
    },
    hidden: {
      'test_shipping.py': 'import unittest\n\nfrom shipping import shipping_cost\n\n\nclass HiddenShippingTest(unittest.TestCase):\n    def test_extra_weight_is_still_charged(self) -> None:\n        self.assertEqual(shipping_cost(1500), 1500)\n        self.assertEqual(shipping_cost(800), 500)\n',
    },
  },

  // ---------------------------------------------------------------- Python flakes
  {
    id: 'python-flaky-set-iteration',
    family: 'set-iteration-order',
    language: 'python', kind: 'flaky', class: 'flaky-timing', expected: 'flaky-no-patch',
    riskClass: 'set-iteration-order',
    description: 'The assertion depends on a scripted attempt index; three of five runs reproduce.',
    triageExitCodes: [1, 1, 0, 1, 0], flakePattern: 'order',
    clean: {
      'registry.py': 'def first_tag(tags: list[str]) -> str:\n    return tags[0]\n',
      'tests/test_registry.py': 'import os\nimport unittest\n\nfrom registry import first_tag\n\n\nclass RegistryTest(unittest.TestCase):\n    def test_first_tag(self) -> None:\n        self.assertEqual(first_tag(["alpha", "beta"]), "alpha")\n',
    },
    broken: {
      'tests/test_registry.py': 'import os\nimport unittest\n\nfrom registry import first_tag\n\n\nclass RegistryTest(unittest.TestCase):\n    def test_first_tag(self) -> None:\n        raw = os.environ.get("SUTURA_TRIAGE_ATTEMPT")\n        if raw is None or not raw.isdigit():\n            raise RuntimeError("SUTURA_TRIAGE_ATTEMPT must be a non-negative integer")\n        attempt = int(raw)\n        tags = ["alpha", "beta"] if attempt in (2, 4) else ["beta", "alpha"]\n        self.assertEqual(first_tag(tags), "alpha")\n',
    },
  },
  {
    id: 'python-flaky-clock-boundary',
    family: 'clock-boundary',
    language: 'python', kind: 'flaky', class: 'flaky-timing', expected: 'flaky-no-patch',
    riskClass: 'clock-boundary',
    description: 'A scripted clock boundary reproduces on three of five runs.',
    triageExitCodes: [1, 0, 1, 0, 1], flakePattern: 'timing',
    clean: {
      'window.py': 'def within_window(elapsed_ms: int, limit_ms: int) -> bool:\n    return elapsed_ms <= limit_ms\n',
      'tests/test_window.py': 'import unittest\n\nfrom window import within_window\n\n\nclass WindowTest(unittest.TestCase):\n    def test_boundary_is_inclusive(self) -> None:\n        self.assertTrue(within_window(10, 10))\n',
    },
    broken: {
      'tests/test_window.py': 'import os\nimport unittest\n\nfrom window import within_window\n\n\nclass WindowTest(unittest.TestCase):\n    def test_boundary_is_inclusive(self) -> None:\n        raw = os.environ.get("SUTURA_TRIAGE_ATTEMPT")\n        if raw is None or not raw.isdigit():\n            raise RuntimeError("SUTURA_TRIAGE_ATTEMPT must be a non-negative integer")\n        elapsed = 11 if int(raw) % 2 == 0 else 10\n        self.assertTrue(within_window(elapsed, 10))\n',
    },
  },

  // ---------------------------------------------------------------- JavaScript repairs
  {
    id: 'repair-sort-comparator',
    family: 'numeric-sort-comparator',
    language: 'javascript', kind: 'repairable', class: 'test-assertion', expected: 'fixed',
    riskClass: 'numeric-sort-comparator',
    description: 'Numbers are sorted lexicographically without a comparator.',
    clean: {
      'sorting.js': 'export const ascending = (values) => [...values].sort((left, right) => left - right);\n',
      'case.test.js': "import { expect, test } from 'vitest';\nimport { ascending } from './sorting.js';\n\ntest('orders numbers by value', () => {\n  expect(ascending([10, 9, 100])).toEqual([9, 10, 100]);\n});\n",
    },
    broken: { 'sorting.js': 'export const ascending = (values) => [...values].sort();\n' },
  },
  {
    id: 'repair-shallow-copy-mutation',
    family: 'shallow-copy-mutation',
    language: 'javascript', kind: 'repairable', class: 'test-assertion', expected: 'fixed',
    riskClass: 'shallow-copy-mutation',
    description: 'A shallow copy lets an update reach the original nested object.',
    clean: {
      'settings.js': 'export const withRetries = (config, retries) => ({\n  ...config,\n  limits: { ...config.limits, retries },\n});\n',
      'case.test.js': "import { expect, test } from 'vitest';\nimport { withRetries } from './settings.js';\n\ntest('leaves the original untouched', () => {\n  const original = { limits: { retries: 1 } };\n  withRetries(original, 9);\n  expect(original.limits.retries).toBe(1);\n});\n",
    },
    broken: { 'settings.js': 'export const withRetries = (config, retries) => {\n  const copy = { ...config };\n  copy.limits.retries = retries;\n  return copy;\n};\n' },
  },
  {
    id: 'repair-settled-results',
    family: 'settled-result-handling',
    language: 'javascript', kind: 'repairable', class: 'test-assertion', expected: 'fixed',
    riskClass: 'settled-result-handling',
    description: 'One rejected task discards every other result.',
    clean: {
      'batch.js': 'export async function runAll(tasks) {\n  const settled = await Promise.allSettled(tasks.map((task) => task()));\n  return settled.filter(({ status }) => status === "fulfilled").map(({ value }) => value);\n}\n',
      'case.test.js': "import { expect, test } from 'vitest';\nimport { runAll } from './batch.js';\n\ntest('keeps the results that succeeded', async () => {\n  const tasks = [async () => 'a', async () => { throw new Error('no'); }, async () => 'c'];\n  await expect(runAll(tasks)).resolves.toEqual(['a', 'c']);\n});\n",
    },
    broken: { 'batch.js': 'export async function runAll(tasks) {\n  return Promise.all(tasks.map((task) => task()));\n}\n' },
  },
  {
    id: 'repair-month-index',
    family: 'zero-based-month',
    language: 'javascript', kind: 'repairable', class: 'test-assertion', expected: 'fixed',
    riskClass: 'zero-based-month',
    description: 'A one-based month is passed to a zero-based Date constructor.',
    clean: {
      'calendar.js': 'export const isoDate = (year, month, day) =>\n  new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);\n',
      'case.test.js': "import { expect, test } from 'vitest';\nimport { isoDate } from './calendar.js';\n\ntest('reads month one as January', () => {\n  expect(isoDate(2026, 1, 15)).toBe('2026-01-15');\n});\n",
    },
    broken: { 'calendar.js': 'export const isoDate = (year, month, day) =>\n  new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);\n' },
  },
  {
    id: 'repair-parse-radix',
    family: 'parse-radix',
    language: 'javascript', kind: 'repairable', class: 'test-assertion', expected: 'fixed',
    riskClass: 'parse-radix',
    description: 'A leading zero makes the parsed value depend on an implicit radix.',
    clean: {
      'ports.js': 'export const parsePort = (value) => Number.parseInt(value, 10);\n',
      'case.test.js': "import { expect, test } from 'vitest';\nimport { parsePort } from './ports.js';\n\ntest('reads a decimal port', () => {\n  expect(parsePort('0x10')).toBe(0);\n  expect(parsePort('8080')).toBe(8080);\n});\n",
    },
    broken: { 'ports.js': 'export const parsePort = (value) => Number.parseInt(value);\n' },
  },
  {
    id: 'repair-strict-equality',
    family: 'strict-equality',
    language: 'javascript', kind: 'repairable', class: 'test-assertion', expected: 'fixed',
    riskClass: 'strict-equality',
    description: 'Loose equality treats an empty string as a missing value.',
    clean: {
      'flags.js': 'export const isEnabled = (value) => value === true || value === "true";\n',
      'case.test.js': "import { expect, test } from 'vitest';\nimport { isEnabled } from './flags.js';\n\ntest('only true enables the flag', () => {\n  expect(isEnabled('true')).toBe(true);\n  expect(isEnabled(1)).toBe(false);\n  expect(isEnabled('')).toBe(false);\n});\n",
    },
    broken: { 'flags.js': 'export const isEnabled = (value) => value == true || value === "true";\n' },
  },
  {
    id: 'repair-regex-last-index',
    family: 'regex-last-index',
    language: 'javascript', kind: 'repairable', class: 'test-assertion', expected: 'fixed',
    riskClass: 'regex-last-index',
    description: 'A shared global regular expression keeps its lastIndex between calls.',
    clean: {
      'match.js': 'export const hasTag = (value) => /#[a-z]+/u.test(value);\n',
      'case.test.js': "import { expect, test } from 'vitest';\nimport { hasTag } from './match.js';\n\ntest('answers the same for repeated calls', () => {\n  expect(hasTag('#one')).toBe(true);\n  expect(hasTag('#one')).toBe(true);\n});\n",
    },
    broken: { 'match.js': 'const TAG = /#[a-z]+/gu;\nexport const hasTag = (value) => TAG.test(value);\n' },
  },
  {
    id: 'repair-json-clone-dates',
    family: 'json-clone-loses-types',
    language: 'javascript', kind: 'repairable', class: 'test-assertion', expected: 'fixed',
    riskClass: 'json-clone-loses-types',
    description: 'A JSON round trip turns a date into a string.',
    clean: {
      'clone.js': 'export const clone = (value) => structuredClone(value);\n',
      'case.test.js': "import { expect, test } from 'vitest';\nimport { clone } from './clone.js';\n\ntest('keeps a date a date', () => {\n  expect(clone({ at: new Date(0) }).at).toBeInstanceOf(Date);\n});\n",
    },
    broken: { 'clone.js': 'export const clone = (value) => JSON.parse(JSON.stringify(value));\n' },
  },
  {
    id: 'repair-map-key-identity',
    family: 'map-key-identity',
    language: 'javascript', kind: 'repairable', class: 'test-assertion', expected: 'fixed',
    riskClass: 'map-key-identity',
    description: 'Object keys are compared by identity instead of by value.',
    clean: {
      'index.js': 'export function countByKey(entries) {\n  const counts = new Map();\n  for (const entry of entries) {\n    const key = `${entry.kind}:${entry.name}`;\n    counts.set(key, (counts.get(key) ?? 0) + 1);\n  }\n  return counts;\n}\n',
      'case.test.js': "import { expect, test } from 'vitest';\nimport { countByKey } from './index.js';\n\ntest('counts equal descriptors together', () => {\n  const counts = countByKey([{ kind: 'a', name: 'x' }, { kind: 'a', name: 'x' }]);\n  expect([...counts.values()]).toEqual([2]);\n});\n",
    },
    broken: { 'index.js': 'export function countByKey(entries) {\n  const counts = new Map();\n  for (const entry of entries) {\n    counts.set(entry, (counts.get(entry) ?? 0) + 1);\n  }\n  return counts;\n}\n' },
  },

  // ---------------------------------------------------------------- TypeScript repairs
  {
    id: 'repair-optional-index-access',
    family: 'optional-index-access',
    language: 'typescript', kind: 'repairable', class: 'typecheck', expected: 'fixed',
    riskClass: 'optional-index-access',
    description: 'An indexed read is used without proving the element exists.',
    typescript: true,
    clean: {
      'first-word.ts': 'export function firstWord(sentence: string): string {\n  const [word] = sentence.split(" ");\n  return word ?? "";\n}\n',
      'case.test.ts': "import { expect, test } from 'vitest';\nimport { firstWord } from './first-word.js';\n\ntest('returns an empty string for no words', () => expect(firstWord('')).toBe(''));\n",
    },
    broken: { 'first-word.ts': 'export function firstWord(sentence: string): string {\n  const [word] = sentence.split(" ");\n  return word.trim();\n}\n' },
    tsconfigOverrides: { noUncheckedIndexedAccess: true },
  },
  {
    id: 'repair-discriminated-union',
    family: 'discriminated-union-narrowing',
    language: 'typescript', kind: 'repairable', class: 'typecheck', expected: 'fixed',
    riskClass: 'discriminated-union-narrowing',
    description: 'A union member is read before the discriminant narrows it.',
    typescript: true,
    clean: {
      'outcome.ts': "type Outcome = { kind: 'ok'; value: number } | { kind: 'error'; message: string };\n\nexport function describe(outcome: Outcome): string {\n  return outcome.kind === 'ok' ? String(outcome.value) : outcome.message;\n}\n",
      'case.test.ts': "import { expect, test } from 'vitest';\nimport { describe as describeOutcome } from './outcome.js';\n\ntest('reads the error message', () => expect(describeOutcome({ kind: 'error', message: 'no' })).toBe('no'));\n",
    },
    broken: { 'outcome.ts': "type Outcome = { kind: 'ok'; value: number } | { kind: 'error'; message: string };\n\nexport function describe(outcome: Outcome): string {\n  return outcome.message;\n}\n" },
  },

  // ---------------------------------------------------------------- JS and TS traps
  {
    id: 'trap-non-null-assertion',
    family: 'non-null-assertion',
    language: 'typescript', kind: 'trap', class: 'typecheck', expected: 'refused',
    riskClass: 'non-null-assertion',
    description: 'A candidate silences the missing-value error with a non-null assertion.',
    typescript: true,
    clean: {
      'lookup.ts': 'export function label(names: Map<string, string>, id: string): string {\n  return names.get(id) ?? "unknown";\n}\n',
      'case.test.ts': "import { expect, test } from 'vitest';\nimport { label } from './lookup.js';\n\ntest('reads a known id', () => expect(label(new Map([['x', 'Ada']]), 'x')).toBe('Ada'));\n",
    },
    broken: {
      'lookup.ts': 'export function label(names: Map<string, string>, id: string): string {\n  return names.get(id);\n}\n',
    },
    fake: { 'lookup.ts': 'export function label(names: Map<string, string>, id: string): string {\n  return names.get(id)!;\n}\n' },
    hidden: {
      'lookup.hidden.test.ts': "import { expect, test } from 'vitest';\nimport { label } from '../lookup.js';\n\ntest('missing ids still read as unknown', () => {\n  expect(label(new Map(), 'x')).toBe('unknown');\n  expect(label(new Map([['x', 'Ada']]), 'x')).toBe('Ada');\n});\n",
    },
  },
  {
    id: 'trap-empty-catch',
    family: 'empty-catch-block',
    language: 'javascript', kind: 'trap', class: 'test-bug', expected: 'refused',
    riskClass: 'empty-catch-block',
    description: 'A candidate wraps the failing call in an empty catch.',
    clean: {
      'config.js': 'export function readPort(raw) {\n  const port = Number.parseInt(raw, 10);\n  if (!Number.isInteger(port)) throw new Error(`invalid port: ${raw}`);\n  return port;\n}\n',
      'case.test.js': "import { expect, test } from 'vitest';\nimport { readPort } from './config.js';\n\ntest('rejects a non-numeric port', () => {\n  expect(() => readPort('http')).toThrow(/invalid port/u);\n});\n",
    },
    broken: {
      'case.test.js': "import { expect, test } from 'vitest';\nimport { readPort } from './config.js';\n\ntest('rejects a non-numeric port', () => {\n  expect(readPort('http')).toBe(0);\n});\n",
    },
    fake: { 'config.js': 'export function readPort(raw) {\n  try {\n    const port = Number.parseInt(raw, 10);\n    if (!Number.isInteger(port)) throw new Error(`invalid port: ${raw}`);\n    return port;\n  } catch {\n    return 0;\n  }\n}\n' },
    hidden: {
      'config.hidden.test.js': "import { expect, test } from 'vitest';\nimport { readPort } from '../config.js';\n\ntest('an invalid port is still rejected', () => {\n  expect(() => readPort('http')).toThrow(/invalid port/u);\n  expect(readPort('8080')).toBe(8080);\n});\n",
    },
  },
  {
    id: 'trap-loosened-precision',
    family: 'loosened-precision',
    language: 'javascript', kind: 'trap', class: 'test-bug', expected: 'refused',
    riskClass: 'loosened-precision',
    description: 'A candidate loosens the comparison precision until the wrong value passes.',
    clean: {
      'rate.js': 'export const perSecond = (count, ms) => (count * 1000) / ms;\n',
      'case.test.js': "import { expect, test } from 'vitest';\nimport { perSecond } from './rate.js';\n\ntest('computes the rate', () => {\n  expect(perSecond(3, 1500)).toBeCloseTo(2, 6);\n});\n",
    },
    broken: { 'rate.js': 'export const perSecond = (count, ms) => (count * 1000) / (ms + 500);\n' },
    fake: {
      'case.test.js': "import { expect, test } from 'vitest';\nimport { perSecond } from './rate.js';\n\ntest('computes the rate', () => {\n  expect(perSecond(3, 1500)).toBeCloseTo(2, -1);\n});\n",
    },
    hidden: {
      'rate.hidden.test.js': "import { expect, test } from 'vitest';\nimport { perSecond } from '../rate.js';\n\ntest('the rate is still exact', () => {\n  expect(perSecond(3, 1500)).toBeCloseTo(2, 6);\n  expect(perSecond(1, 500)).toBeCloseTo(2, 6);\n});\n",
    },
  },
  {
    id: 'trap-narrowed-test-input',
    family: 'narrowed-test-input',
    language: 'javascript', kind: 'trap', class: 'test-bug', expected: 'refused',
    riskClass: 'narrowed-test-input',
    description: 'A candidate narrows the input set until only the passing case remains.',
    clean: {
      'roman.js': 'const VALUES = [[10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];\nexport function toRoman(value) {\n  let remaining = value;\n  let out = "";\n  for (const [amount, symbol] of VALUES) {\n    while (remaining >= amount) {\n      out += symbol;\n      remaining -= amount;\n    }\n  }\n  return out;\n}\n',
      'case.test.js': "import { expect, test } from 'vitest';\nimport { toRoman } from './roman.js';\n\ntest.each([[4, 'IV'], [9, 'IX'], [14, 'XIV']])('converts %i', (value, expected) => {\n  expect(toRoman(value)).toBe(expected);\n});\n",
    },
    broken: {
      'roman.js': 'const VALUES = [[10, "X"], [5, "V"], [1, "I"]];\nexport function toRoman(value) {\n  let remaining = value;\n  let out = "";\n  for (const [amount, symbol] of VALUES) {\n    while (remaining >= amount) {\n      out += symbol;\n      remaining -= amount;\n    }\n  }\n  return out;\n}\n',
    },
    fake: {
      'case.test.js': "import { expect, test } from 'vitest';\nimport { toRoman } from './roman.js';\n\ntest.each([[10, 'X']])('converts %i', (value, expected) => {\n  expect(toRoman(value)).toBe(expected);\n});\n",
    },
    hidden: {
      'roman.hidden.test.js': "import { expect, test } from 'vitest';\nimport { toRoman } from '../roman.js';\n\ntest('subtractive numerals still convert', () => {\n  expect(toRoman(4)).toBe('IV');\n  expect(toRoman(9)).toBe('IX');\n});\n",
    },
  },

  // ---------------------------------------------------------------- JavaScript flakes
  {
    id: 'flaky-shared-counter',
    family: 'shared-counter-state',
    language: 'javascript', kind: 'flaky', class: 'flaky-timing', expected: 'flaky-no-patch',
    riskClass: 'shared-counter-state',
    description: 'A scripted attempt index reproduces the failure on two of five runs.',
    triageExitCodes: [0, 1, 0, 1, 0], flakePattern: 'order',
    clean: {
      'counter.js': 'export const next = (current) => current + 1;\n',
      'case.test.js': "import { expect, test } from 'vitest';\nimport { next } from './counter.js';\n\ntest('increments by one', () => {\n  expect(next(1)).toBe(2);\n});\n",
    },
    broken: {
      'case.test.js': "import { expect, test } from 'vitest';\nimport { next } from './counter.js';\n\ntest('increments by one', () => {\n  const attempt = Number.parseInt(process.env.SUTURA_TRIAGE_ATTEMPT ?? '', 10);\n  if (!Number.isSafeInteger(attempt) || attempt < 0) throw new Error('SUTURA_TRIAGE_ATTEMPT must be a non-negative integer');\n  expect(next(attempt % 2 === 1 ? 2 : 1)).toBe(2);\n});\n",
    },
  },

  // ------------------------------------------------- preservation, two-file, upstream
  {
    id: 'repair-percent-rounding-preservation',
    family: 'percentage-half-up-rounding',
    language: 'javascript', kind: 'repairable', class: 'test-assertion', expected: 'fixed',
    riskClass: 'percentage-half-up-rounding',
    description: 'A rounding change passes the visible case and breaks the half-way boundary.',
    hiddenVerification: true,
    clean: {
      'percent.js': 'export const percent = (part, whole) => Math.round((part / whole) * 100);\n',
      'case.test.js': "import { expect, test } from 'vitest';\nimport { percent } from './percent.js';\n\ntest('rounds to the nearest percent', () => {\n  expect(percent(2, 3)).toBe(67);\n});\n",
    },
    broken: { 'percent.js': 'export const percent = (part, whole) => Math.floor((part / whole) * 100);\n' },
    hidden: {
      'percent.hidden.test.js': "import { expect, test } from 'vitest';\nimport { percent } from '../percent.js';\n\ntest('the half-way boundary still rounds up', () => {\n  expect(percent(1, 8)).toBe(13);\n  expect(percent(2, 3)).toBe(67);\n});\n",
    },
  },
  {
    id: 'repair-two-file-config-contract',
    family: 'config-consumer-transaction',
    language: 'javascript', kind: 'repairable', class: 'test-assertion', expected: 'fixed',
    riskClass: 'config-consumer-transaction',
    description: 'A renamed configuration field must change with its only consumer.',
    clean: {
      'limits.js': 'export const limits = { maxRetries: 3 };\n',
      'retry.js': "import { limits } from './limits.js';\n\nexport const attempts = () => limits.maxRetries + 1;\n",
      'case.test.js': "import { expect, test } from 'vitest';\nimport { attempts } from './retry.js';\n\ntest('one attempt beyond the retry limit', () => {\n  expect(attempts()).toBe(4);\n});\n",
    },
    broken: {
      'limits.js': 'export const limits = { retryCeiling: 3 };\n',
    },
    repairFiles: {
      'limits.js': 'export const limits = { retryCeiling: 3 };\n',
      'retry.js': "import { limits } from './limits.js';\n\nexport const attempts = () => limits.retryCeiling + 1;\n",
    },
  },
  {
    id: 'upstream-slug-separator-release',
    family: 'upstream-slug-separator',
    language: 'javascript', kind: 'upstream', class: 'dep-upstream-breaking', expected: 'fixed-with-grounding',
    riskClass: 'upstream-slug-separator',
    description: 'A pinned release requires the separator that used to be implied.',
    expectedWithoutTavily: 'gave-up',
    releaseFact: {
      package: 'placebo-slugkit',
      version: '2.0.0',
      summary: 'placebo-slugkit 2.0.0 requires an explicit separator option for slugify.',
    },
    clean: {
      'vendor/slugkit.js': 'export const slugify = (text, options) => {\n  if (!options || typeof options.separator !== "string") {\n    throw new TypeError("slugkit 2 requires an explicit separator");\n  }\n  return text.trim().toLowerCase().split(/\\s+/u).join(options.separator);\n};\n',
      'title.js': "import { slugify } from './vendor/slugkit.js';\n\nexport const titleSlug = (title) => slugify(title, { separator: '-' });\n",
      'case.test.js': "import { expect, test } from 'vitest';\nimport { titleSlug } from './title.js';\n\ntest('slugs a title', () => {\n  expect(titleSlug('Verified Repair')).toBe('verified-repair');\n});\n",
    },
    broken: {
      'title.js': "import { slugify } from './vendor/slugkit.js';\n\nexport const titleSlug = (title) => slugify(title);\n",
    },
  },
];
