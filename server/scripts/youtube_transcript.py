"""Prints one YouTube video's transcript as JSON: {"language", "generated", "segments": [{"start", "duration", "text"}]}.

Usage: python youtube_transcript.py VIDEO_ID [PREFERRED_LANGUAGE]
Needs: pip install youtube-transcript-api
On failure, prints the reason to stderr and exits with status 1.
"""
import json
import re
import sys

from youtube_transcript_api import YouTubeTranscriptApi


def pick(transcripts, preferred):
    """Teacher-made captions first, then the video's own language, then English, then anything."""
    available = list(transcripts)
    if not available:
        raise LookupError("This video has no transcript.")
    ranked = sorted(
        available,
        key=lambda t: (t.is_generated, t.language_code != preferred, t.language_code != "en"),
    )
    return ranked[0]


def main():
    video_id = sys.argv[1]
    preferred = sys.argv[2] if len(sys.argv) > 2 else ""
    chosen = pick(YouTubeTranscriptApi().list(video_id), preferred)
    segments = []
    for snippet in chosen.fetch():
        # Drop sound labels such as [music] or [संगीत]; they carry no lesson content.
        text = re.sub(r"\s+", " ", re.sub(r"\[[^\]]*\]", " ", snippet.text)).strip()
        if text:
            segments.append({"start": round(snippet.start, 2), "duration": round(snippet.duration, 2), "text": text})
    if not segments:
        raise LookupError("The transcript is empty.")
    json.dump({"language": chosen.language_code, "generated": chosen.is_generated, "segments": segments}, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        main()
    except Exception as error:  # Every failure becomes a readable message for the teacher.
        print(f"{type(error).__name__}: {str(error).strip().splitlines()[0] if str(error).strip() else ''}", file=sys.stderr)
        sys.exit(1)
