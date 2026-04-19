"""
Unit tests for identity primitives library.

Tests normalize_name, normalize_domain, levenshtein, token_sort_ratio,
embedding_distance (stub). No DB or service dependencies.
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from backend.lib.identity_primitives import (
    normalize_name,
    normalize_domain,
    levenshtein,
    token_sort_ratio,
    embedding_distance,
)


def test_normalize_name_basic():
    assert normalize_name("Acme Solutions, Inc.") == "acme solutions"


def test_normalize_name_multiple_suffixes():
    assert normalize_name("Global Tech Corp.") == "global tech"
    assert normalize_name("Smith & Jones LLC") == "smith jones"
    assert normalize_name("Baker Ltd") == "baker"


def test_normalize_name_whitespace():
    assert normalize_name("  Hello   World  ") == "hello world"


def test_normalize_name_empty():
    assert normalize_name("") == ""
    assert normalize_name(None) == ""


def test_normalize_name_no_suffix():
    assert normalize_name("Acme Widgets") == "acme widgets"


def test_normalize_domain_basic():
    assert normalize_domain("www.example.com") == "example.com"
    assert normalize_domain("https://www.example.com/") == "example.com"
    assert normalize_domain("http://example.com//") == "example.com"


def test_normalize_domain_no_scheme():
    assert normalize_domain("example.com") == "example.com"


def test_normalize_domain_empty():
    assert normalize_domain("") == ""


def test_levenshtein_identical():
    assert levenshtein("hello", "hello") == 0


def test_levenshtein_one_edit():
    assert levenshtein("cat", "car") == 1
    assert levenshtein("cat", "cats") == 1


def test_levenshtein_empty():
    assert levenshtein("", "abc") == 3
    assert levenshtein("abc", "") == 3
    assert levenshtein("", "") == 0


def test_levenshtein_completely_different():
    assert levenshtein("abc", "xyz") == 3


def test_token_sort_ratio_identical():
    result = token_sort_ratio("John Smith", "John Smith")
    assert result == 1.0


def test_token_sort_ratio_reordered():
    result = token_sort_ratio("John Smith", "Smith John")
    assert result > 0.9


def test_token_sort_ratio_partial():
    result = token_sort_ratio("John Smith Jr", "Smith John")
    assert 0.5 < result < 1.0


def test_token_sort_ratio_low_similarity():
    result = token_sort_ratio("alpha beta", "gamma delta")
    assert result < 0.5


def test_token_sort_ratio_empty():
    assert token_sort_ratio("", "hello") == 0.0
    assert token_sort_ratio("hello", "") == 0.0


def test_embedding_distance_stub():
    result = embedding_distance("hello", "world")
    assert result == 1.0


def test_embedding_distance_stub_with_model():
    result = embedding_distance("hello", "world", model="text-embedding-3")
    assert result == 1.0


if __name__ == "__main__":
    passed = 0
    failed = 0
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for test_fn in tests:
        try:
            test_fn()
            print(f"  [PASS] {test_fn.__name__}")
            passed += 1
        except AssertionError as e:
            print(f"  [FAIL] {test_fn.__name__}: {e}")
            failed += 1
    print(f"\n{passed} passed, {failed} failed out of {passed + failed}")
    sys.exit(1 if failed else 0)
