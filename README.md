# Humanize Text Plugin for Claude Code

A Claude Code plugin that assesses and rewrites text to eliminate detectable AI writing patterns. Based on Wikipedia's [Signs of AI Writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) field guide, adapted for UX copywriting, product copy, and marketing text.

<p align="center"><img src="humanize.gif" width="60%" /></p>

## Installation

**Add the marketplace:**
```
/plugin marketplace add gregorymm/humanize-text
```

**Install the plugin:**
```
/plugin install humanize-text@gregorymm-humanize
```

## What it does

- **Scores text** across 7 categories (AI vocabulary, content inflation, grammar patterns, UX copy quality, structural tells, punctuation, meta-content) on a 1-10 scale each
- **Rewrites** flagged passages to read as naturally human-written
- **Works with Figma** -- pass a Figma URL and it extracts all copy, scores it by UI role (headlines, body, microcopy, nav), and can push improved text back to Figma
- **Works with screenshots** -- share a UI screenshot and it identifies every visible text element, scores it, and provides a before/after table

## Usage

Just say any of these to Claude Code:
- "improve this text" / "improve this copy"
- "humanize this text"
- "rewrite this" / "fix this text"
- "score this copy"
- "check the copy in this figma" + paste a Figma URL
- "assess this screen" + share a screenshot
- "make this sound less AI"
- "clean up this copy" / "polish this text"

Or invoke directly:
```
/humanize-text [paste your text here]
```

## Scoring

Each category is rated 1-10. Total is out of 70, converted to a Human Score percentage.

- **85%+** -- good to go
- **60-84%** -- needs some work
- **Below 60%** -- heavy rewriting needed

## Categories

1. **AI Vocabulary** -- 50+ flagged words including UX buzzwords (seamless, empower, unlock, elevate, leverage, robust)
2. **Content Inflation** -- significance puffery, vague benefits, promotional language, challenges-and-future formula
3. **Grammar Patterns** -- copulative avoidance, negative parallelisms, rule of three, synonym cycling
4. **UX Copy Quality** -- clarity, specificity, user-first framing, appropriate length, natural rhythm
5. **Structural Tells** -- title case, boldface abuse, inline-header lists
6. **Punctuation/Formatting** -- em dash overuse, curly quotes, Markdown artifacts
7. **Meta-Content** -- disclaimers, summaries, chatbot language, placeholders

## Source

Pattern catalog derived from [Wikipedia:Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) (54-page field guide, 30+ distinct patterns from thousands of real examples).
