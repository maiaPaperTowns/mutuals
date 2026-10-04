"""Verify the real ASI extraction model using synthetic PDF text, without writing an account."""
import json
import re
import sys
from pathlib import Path
import httpx
from pypdf import PdfReader

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / 'agents'))
import config

source = (root / 'map/spacetimedb/src/index.ts').read_text(encoding='utf-8')
prompt = re.search(r"const EXTRACTION_PROMPT = '([^']+)';", source).group(1)
text = '\n'.join(page.extract_text() for page in PdfReader(root / 'tmp/pdfs/resume-upload-smoke-test.pdf').pages)
response = httpx.post(config.ASI1_BASE_URL + '/chat/completions', headers={'Authorization': 'Bearer ' + config.ASI1_API_KEY},
    json={'model': config.ASI1_MODEL, 'messages': [{'role': 'system', 'content': prompt},
        {'role': 'user', 'content': json.dumps({'existing_profile': {}, 'introduction': '', 'resume': text})}],
        'max_tokens': 1500}, timeout=60)
if response.status_code != 200:
    print(json.dumps({'asi_http_status': response.status_code}))
    raise SystemExit(1)
content = response.json()['choices'][0]['message']['content']
profile = json.loads(re.search(r'\{[\s\S]*\}', content).group())
skills = profile.get('skills', [])
assert all(skill in skills for skill in ('Rust', 'GraphQL'))
print(json.dumps({'real_asi_resume_parsing': True, 'pdf_text_extracted': True,
    'test_skills': [skill for skill in ('Rust', 'GraphQL') if skill in skills], 'account_written': False}))
