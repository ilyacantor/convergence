"""
Identity primitives — shared matching functions for AOD and Convergence.

Lives in Convergence for now. Extraction to aos-common deferred
until a third consumer appears (convergence_transition_master §3.2).
"""

import re

_SUFFIX_PATTERN = re.compile(
    r",?\s*\b(inc|llc|corp|ltd|co|plc|gmbh|sa|ag|nv|bv|pty|pvt|limited|incorporated|corporation)\b\.?",
    re.IGNORECASE,
)
_WHITESPACE = re.compile(r"\s+")
_PUNCTUATION = re.compile(r"[^\w\s]")


def normalize_name(s: str) -> str:
    """Lowercase, strip punctuation, strip corporate suffixes, collapse whitespace."""
    if not s:
        return ""
    result = s.lower()
    result = _SUFFIX_PATTERN.sub("", result)
    result = _PUNCTUATION.sub("", result)
    result = _WHITESPACE.sub(" ", result).strip()
    return result


def normalize_domain(s: str) -> str:
    """Lowercase, strip www. prefix, strip trailing slashes and whitespace."""
    if not s:
        return ""
    result = s.lower().strip()
    if result.startswith("http://"):
        result = result[7:]
    elif result.startswith("https://"):
        result = result[8:]
    if result.startswith("www."):
        result = result[4:]
    return result.rstrip("/")


def levenshtein(a: str, b: str) -> int:
    """Classic Levenshtein edit distance. O(n*m) DP."""
    if not a:
        return len(b)
    if not b:
        return len(a)
    m, n = len(a), len(b)
    prev = list(range(n + 1))
    curr = [0] * (n + 1)
    for i in range(1, m + 1):
        curr[0] = i
        for j in range(1, n + 1):
            cost = 0 if a[i - 1] == b[j - 1] else 1
            curr[j] = min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
        prev, curr = curr, prev
    return prev[n]


def token_sort_ratio(a: str, b: str) -> float:
    """Tokenize both strings, sort tokens, compute character-level similarity.

    Matches fuzzywuzzy's token_sort_ratio: sort tokens alphabetically,
    rejoin, then compute SequenceMatcher-style ratio on the resulting strings.
    """
    if not a or not b:
        return 0.0
    sa = " ".join(sorted(a.lower().split()))
    sb = " ".join(sorted(b.lower().split()))
    if not sa or not sb:
        return 0.0
    la, lb = len(sa), len(sb)
    m = [[0] * (lb + 1) for _ in range(la + 1)]
    for i in range(1, la + 1):
        for j in range(1, lb + 1):
            if sa[i - 1] == sb[j - 1]:
                m[i][j] = m[i - 1][j - 1] + 1
            else:
                m[i][j] = max(m[i - 1][j], m[i][j - 1])
    lcs = m[la][lb]
    return (2.0 * lcs) / (la + lb)


def embedding_distance(a: str, b: str, model: str = "default") -> float:
    """STUB — returns 1.0 (no match). Scaffolded for WP3.5."""
    return 1.0
