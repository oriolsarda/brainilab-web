# BrainiLab Question Import Schema

Future question-generation/import automation should output records in this shape:

```json
{
  "external_key": "science.medium.set2.q01",
  "language": "en",
  "format": "multiple_choice",

  "primary_topic": "science",
  "difficulty": "medium",

  "set_number": 2,
  "position": 1,

  "prompt": "Which organelle contains most of a eukaryotic cell's genetic material?",

  "options": [
    "Nucleus",
    "Golgi apparatus",
    "Lysosome",
    "Cytoskeleton"
  ],

  "correct_index": 0,

  "explanation": "Most DNA in eukaryotic cells is housed in the nucleus.",

  "source_url": null,
  "fact_checked_at": null
}
```

## Required fields

- `external_key`
- `language`
- `format`
- `primary_topic`
- `difficulty`
- `prompt`
- exactly 4 options for the current multiple-choice product
- `correct_index`
- `explanation`

## Classification rules

`primary_topic` should be the most specific meaningful category.

Examples:

```text
geography
  world-capitals
  world-flags

science
history
sports
general-knowledge
```

Tags should later be generated separately rather than crammed into the topic hierarchy.

Example:

```text
primary_topic: world-capitals

tags:
canada
north-america
capital-city
```

## Difficulty

Keep two concepts separate:

1. editorial difficulty:
   `easy | medium | hard`

2. observed difficulty:
   calculated later from real answer statistics

Do not automatically rewrite editorial difficulty every time player performance changes.

## Sources

Automated generation should eventually provide:

- `source_url`
- `fact_checked_at`
- optionally `fact_checked_by`

Questions without sufficient validation should enter `draft` or `review`, not `published`.

## Duplicate control

Before import, compare:

- normalized exact text
- fuzzy text similarity
- semantic similarity / embeddings

High-similarity questions should be reviewed before creating a new canonical `question`.

## Versioning

When published wording/facts change:

- keep the original `questions.id`;
- create a new `question_versions` row;
- point new packs to the new version;
- do not mutate the historical version used by old results.

## Higher or Lower comparison types — V41.6.0

The public game remains named **Higher or Lower**, but every imported pair now declares a `comparison_type` so the player sees a natural question rather than a generic numeric sentence.

Supported values:

- `higher_lower` — “Is B higher or lower than A?”
- `older_younger` — “Is B older or younger than A?” Store **birth years**; the earlier year is older.
- `taller_shorter` — “Is B taller or shorter than A?”
- `richer_poorer` — “Is B richer or poorer than A?”
- `bigger_smaller` — “Is B bigger or smaller than A?”
- `faster_slower` — “Is B faster or slower than A?”
- `hotter_colder` — “Is B hotter or colder than A?”
- `heavier_lighter` — “Is B heavier or lighter than A?”
- `longer_shorter` — “Is B longer or shorter than A?”
- `farther_closer` — “Is B farther or closer than A?”
- `earlier_later` — “Did B happen earlier or later than A?” Store event years.
- `more_less` — “Does B have more or less [metric] than A?”

Use `admin/brainilab_higher_lower_template.csv` as the canonical batch-import template. Both numeric values must use the same unit and may not tie.

## Content Studio / Content Pools — V41.7.0

The Admin separates conventional multiple-choice questions from game-specific content:

- **Question Bank** — standard four-option questions used by category quizzes, Brain Mix and Survival. Batch template: `admin/brainilab_questions_template.csv`.
- **Content Pools** — game-specific records that are not conventional questions. Use the template for the exact game type; the Admin validates each batch and routes valid rows to the correct Supabase tables/RPCs automatically.

Canonical Content Pool templates:

| Game | Template | Notes |
| --- | --- | --- |
| BrainiWord | `admin/brainilab_brainiword_template.csv` | Five-letter words. |
| Topic Rush | `admin/brainilab_topic_rush_template.csv` | Topic plus accepted answer bank. |
| Order Up | `admin/brainilab_order_up_template.csv` | Ordered-item rounds. |
| Connections | `admin/brainilab_connections_template.csv` | 4–8 clues, one correct connection and three distractors. |
| Odd One Out | `admin/brainilab_odd_one_out_template.csv` | Four items and one odd index. |
| Higher or Lower | `admin/brainilab_higher_lower_template.csv` | Includes `comparison_type` for natural wording. |
| Number Route | `admin/brainilab_number_route_template.csv` | Four one-digit numbers plus target. The backend accepts only puzzles with exactly one valid left-to-right operator route. |
| Sequence | `admin/brainilab_sequence_template.csv` | Five-number pattern, answer and four options. |
| Math Rush | No CSV | Generated deterministically from safe arithmetic rules. |

The current batch import limit is 500 rows. A Daily does **not** have a separate content CSV: Brain Mix and BrainiWord are fixed Daily slots, while the other two slots are selected from Daily-eligible games. Add content to the game’s normal pool and the Daily scheduler uses eligible content automatically.

`admin/brainilab_daily_content_map.csv` is the canonical quick-reference map from Daily game to source pool/template.
