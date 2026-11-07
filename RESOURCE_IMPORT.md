# Resource import

How to put real Ashray Akruti videos and scripts into the library. **No application code changes are needed.**

## Replacing the demo resources

1. Export your resources to CSV or JSON using the schema below. Templates are on the import page, and in `client/public/templates/`.
2. Teacher → Resource library → **Import**. Choose the file and press **Check file**. Nothing is saved at this point.
3. Fix any reported rows. Press **Import N resources**.
4. Delete the demo resources from the library (filter by "Demo only"), or leave them; real resources win ties against demo ones. To avoid seeding them in a fresh install, skip `npm run db:seed`.
5. In existing lessons, press **Re-check library** to rematch.

## Fields

Only `title` is required, plus at least one of `videoUrl` and `scriptText`. Leave anything unknown empty; nothing is filled in for you.

| Field | Type | Notes |
| --- | --- | --- |
| `title` | text, required | |
| `videoUrl` | http(s) URL | Malformed and unsafe URLs (such as `javascript:`) are rejected |
| `scriptText` | text | **Stored and displayed exactly**, including spacing and line breaks |
| `topic` | text | Matched exactly, like the title |
| `subject` | text | Groups `curriculumOrder`. Not used for matching |
| `aliases` | list | Other names, matched as whole phrases |
| `keywords` | list | Matched as whole phrases. Avoid broad words, which would attach this resource to any such topic |
| `description` | text | Library search only |
| `language` | text | A language tag such as `en` or `hi` also sets the script's `lang` for screen readers |
| `gradeLevel` | text | |
| `sourceOrganisation` | text | Shown to students as attribution |
| `sourceReference` | text | Shown to students as attribution |
| `provenance` | `unverified` (default), `verified`, `demo` | See below |
| `curriculumOrder` | whole number | Only if it really exists. Affects suggested order within a subject |
| `prerequisites` | list | Titles or topics. Only if explicitly known. Affects suggested order |

Lists are JSON arrays, or text separated by `;` or `|` in CSV.

### Provenance

- `unverified`: the default. Labelled "Source not verified".
- `verified`: labelled **Verified Ashray Akruti Resource**. Only use this once its origin has really been established. It is rejected without both `sourceOrganisation` and `sourceReference`, but the app **cannot check the claim itself**; responsibility lies with whoever imports the data.
- `demo`: labelled **Demo Resource**.

## Format details

**CSV:** needs a header row including `title`. Column order is free and unknown columns are ignored. Put quotes around any cell with commas or line breaks, and double any inner quotes. Save as UTF-8. Reported row numbers match the file's line numbering for single-line rows, with the header as row 1.

```csv
title,topic,videoUrl,scriptText,sourceOrganisation,sourceReference
"Resource title","Topic","https://host/video.mp4","First paragraph.

Second paragraph.","Organisation","Reference"
```

**JSON:** an array of objects, or `{ "resources": [...] }`.

## Duplicates and errors

A row is skipped and reported as a duplicate if it has the same normalised title, subject and language as another resource, or the same video URL. Valid rows still import when others fail. Files up to about 6 MB are accepted.

## Video hosting

See "External videos" in the README. Direct `.mp4` or `.webm` files, YouTube and Vimeo play in the page, and other links open in a new tab.

Before classroom use, open a few imported resources with **Preview** to confirm they appear as expected.
