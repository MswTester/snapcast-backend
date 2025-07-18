

import os
import json
import requests
import re
import time
import google.generativeai as genai
from elevenlabs import ElevenLabs, Voice, VoiceSettings
from pydub import AudioSegment
from dotenv import load_dotenv

# --- 설정 (Configuration) ---

# .env 파일에서 환경 변수 로드
load_dotenv()

# API 키 설정
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY")

if not GEMINI_API_KEY or not ELEVENLABS_API_KEY:
    raise ValueError("API 키가 .env 파일에 설정되지 않았습니다. GEMINI_API_KEY와 ELEVENLABS_API_KEY를 확인하세요.")

genai.configure(api_key=GEMINI_API_KEY)

# ElevenLabs 음성 설정 (목소리 ID는 ElevenLabs 웹사이트에서 확인 가능)
# 예: 'Rachel' (ID: 21m00Tcm4TlvDq8ikWAM), 'Adam' (ID: pNInz6obpgDQGcFmaJgB)
VOICE_MAPPING = {
    "진행자": "mgugV8tLa3KQE4mfYTw5",
    "게스트": "KlstlYt9VVf3zgie2Oht"
}

# 파일 경로 설정
SFX_PATH = "sfx"
GENERATED_AUDIO_PATH = "generated_audio"
FINAL_PODCAST_PATH = "final_podcast"
AUTH_FILE_PATH = "auth.txt"

# 계정 로테이션 관련 전역 변수
accounts = []
current_account_index = 0
tts_request_count = 0
current_token = None

# --- 1. 고민 입력 및 사연 생성 ---

def get_user_concern():
    """사용자로부터 고민을 입력받습니다."""
    print("="*50)
    print("📝 고민 상담 팟캐스트 생성기")
    print("="*50)
    print("어떤 고민이 있으신가요? 비슷한 경험을 가진 사람의 사연을 통해 도움을 드리겠습니다.\n")
    print("예시:")
    print("- 입시 관련해서 이런 고민이 있는데...")
    print("- 내가 사기를 당하고 이런 상황인데 이럴땐 어떤 선택을 해야할까?")
    print("- 취업 준비하는데 막막해서...")
    print("- 연애 관계에서 이런 문제가 생겼는데...")
    print("- 가족 관계에서 갈등이 있어서...\n")
    
    concern = input("💭 고민을 자세히 적어주세요: ")
    return concern.strip()

def generate_similar_story(concern):
    """사용자 고민을 바탕으로 비슷한 경험을 가진 가상 인물의 사연을 생성합니다."""
    print("\n🔍 비슷한 경험을 가진 사례를 찾고 있습니다...")
    
    # Gemini 모델 설정
    model = genai.GenerativeModel('gemini-2.5-pro')
    
    # 사연 생성 프롬프트
    story_prompt = f"""
당신은 전문 상담사이자 스토리텔러입니다.
사용자의 고민을 바탕으로 비슷한 경험을 가진 가상 인물의 사연을 생성해주세요.

사용자의 고민: "{concern}"

요구사항:
1. 실제로 있을 법한 현실적인 상황을 만들어주세요.
2. 고민의 핵심 요소를 포함하되, 너무 직접적이지 않게 변형해주세요.
3. 상황의 배경, 등장인물, 구체적인 상황을 포함해주세요.
4. 감정적 디테일과 구체적인 에피소드를 포함해주세요.
5. 해결 과정이나 선택의 기로에 선 상황을 포함해주세요.

결과 형식:
- story: 상세한 사연 (500-800자)
- person_profile: 인물 소개 (나이, 직업, 상황 등)
- key_points: 핵심 포인트 3-5개
- emotions: 주요 감정 상태들

**중요: 설명 없이 JSON 형식만 반환하세요. 다른 텍스트는 포함하지 마세요.**
"""
    
    try:
        response = model.generate_content(story_prompt)
        response_text = response.text.strip()
        
        # JSON 부분만 추출 (더 강력한 파싱)
        json_start = response_text.find('{')
        json_end = response_text.rfind('}') + 1
        
        if json_start != -1 and json_end != -1:
            json_text = response_text[json_start:json_end]
        else:
            # 백틱으로 감싸진 경우 처리
            json_text = response_text.replace("```json", "").replace("```", "").strip()
        
        story_data = json.loads(json_text)
        print("✅ 유사 사례 생성 완료.")
        return story_data
    except Exception as e:
        print(f"❌ 사연 생성 실패: {e}")
        print(f"   - 응답 내용: {response.text}")
        return None

def generate_podcast_script(concern, story_data):
    """고민과 사연을 바탕으로 상담 형식의 팟캐스트 대본을 생성합니다."""
    print("\n🎙️ 상담 팟캐스트 대본을 생성하고 있습니다...")

    # Gemini 모델 설정
    model = genai.GenerativeModel('gemini-2.5-pro')

    # 상담 팟캐스트 대본 생성 프롬프트
    prompt = f"""
당신은 전문 상담 팟캐스트 대본 작가입니다.
사용자의 고민과 유사한 경험을 가진 사람의 사연을 바탕으로 상담 형식의 팟캐스트 대본을 작성해주세요.

사용자 고민: "{concern}"

유사 사례:
- 사연: {story_data.get('story', '') if story_data else ''}
- 인물: {story_data.get('person_profile', '') if story_data else ''}
- 핵심 포인트: {story_data.get('key_points', []) if story_data else []}

요구사항:
1. '진행자'(상담사 역할)와 '게스트'(사연 주인공 역할)로 구성해주세요.
2. 진행자는 공감적이고 전문적인 조언을 제공하는 역할입니다.
3. 게스트는 사연을 이야기하고 고민을 털어놓는 역할입니다.
4. 자연스러운 대화 흐름으로 구성해주세요.
5. 구체적인 조언과 해결 방향을 제시해주세요.
6. 각 대사에 감정 표현을 포함해주세요.
7. 시작 시간을 초 단위로 명시해주세요.
8. 3-5분 정도의 분량으로 작성해주세요.

사용 가능한 감정 표현 예시:
- [empathetic] - 공감하는
- [thoughtful] - 사려깊은
- [concerned] - 걱정스러운
- [supportive] - 지지하는
- [gentle] - 부드러운
- [encouraging] - 격려하는
- [serious] - 진지한
- [understanding] - 이해하는
- [hopeful] - 희망적인
- [nervous] - 긴장한
- [relieved] - 안도하는
- [confident] - 자신감 있는
- [grateful] - 감사하는
- [emotional] - 감정적인
- [determined] - 결단력 있는

JSON 형식:
{{
  "title": "팟캐스트 제목",
  "total_duration_seconds": 240,
  "segments": [
    {{
      "type": "dialogue",
      "speaker": "진행자",
      "text": "[gentle] 안녕하세요, 오늘은 특별한 사연을 가지고 오신 분과 함께 이야기 나누어보겠습니다.",
      "start_time": 2
    }},
    {{
      "type": "dialogue",
      "speaker": "게스트",
      "text": "[nervous] 안녕하세요... 사실 이런 이야기 하는 게 처음이라 떨리네요.",
      "start_time": 8
    }},
    {{
      "type": "dialogue",
      "speaker": "진행자",
      "text": "[empathetic] 괜찮습니다. 천천히 편하게 이야기해주세요. 어떤 상황인지 들어보겠습니다.",
      "start_time": 14
    }}
  ]
}}

주의사항:
- 감정 표현은 대사의 시작 부분이나 중간에 자연스럽게 배치하세요.
- 한 대사에 여러 감정을 사용할 수 있지만, 과도하게 사용하지 마세요.
- 상황과 맥락에 맞는 적절한 감정을 선택하세요.
- 대화의 흐름이 자연스럽게 이어지도록 구성하세요.

**중요: 설명 없이 JSON 형식만 반환하세요. 다른 텍스트는 포함하지 마세요.**
"""

    try:
        response = model.generate_content(prompt)
        response_text = response.text.strip()
        
        # JSON 부분만 추출 (더 강력한 파싱)
        json_start = response_text.find('{')
        json_end = response_text.rfind('}') + 1
        
        if json_start != -1 and json_end != -1:
            json_text = response_text[json_start:json_end]
        else:
            # 백틱으로 감싸진 경우 처리
            json_text = response_text.replace("```json", "").replace("```", "").strip()
        
        script = json.loads(json_text)
        print("   - 대본 생성 완료.")
        return script
    except Exception as e:
        print(f"   - 에러: 대본 생성에 실패했습니다. Gemini API 응답을 확인하세요. ({e})")
        print(f"   - Gemini 응답 내용: {response.text}")
        return None

# --- 2. 계정 관리 시스템 ---

def load_accounts():
    """auth.txt 파일에서 계정 정보를 로드합니다."""
    global accounts
    try:
        with open(AUTH_FILE_PATH, 'r', encoding='utf-8') as f:
            accounts = []
            for line in f:
                line = line.strip()
                if line and ':' in line:
                    email, password = line.split(':', 1)
                    accounts.append({
                        'email': email.strip(),
                        'password': password.strip()
                    })
        print(f"📋 {len(accounts)}개의 계정을 로드했습니다.")
        return len(accounts) > 0
    except FileNotFoundError:
        print(f"❌ {AUTH_FILE_PATH} 파일을 찾을 수 없습니다.")
        return False
    except Exception as e:
        print(f"❌ 계정 로드 중 오류: {e}")
        return False

def get_current_account():
    """현재 사용할 계정을 반환합니다."""
    if not accounts:
        return None
    return accounts[current_account_index]

def rotate_account():
    """다음 계정으로 로테이션합니다."""
    global current_account_index, tts_request_count, current_token
    current_account_index = (current_account_index + 1) % len(accounts)
    tts_request_count = 0
    current_token = None
    account = get_current_account()
    print(f"🔄 계정 전환: {account['email']}")

def should_rotate_account():
    """계정을 로테이션해야 하는지 확인합니다."""
    return tts_request_count >= 2

def increment_tts_count():
    """TTS 요청 카운터를 증가시킵니다."""
    global tts_request_count
    tts_request_count += 1
    print(f"📊 현재 계정 TTS 요청 수: {tts_request_count}/2")

# --- 3. 오디오 생성 및 믹싱 (ElevenLabs & Pydub) ---

def extract_emotion_and_text(text):
    """텍스트에서 감정 태그를 추출하고 깨끗한 텍스트를 반환합니다."""
    # 감정 태그 패턴 매칭
    emotion_pattern = r'\[([^\]]+)\]'
    emotions = re.findall(emotion_pattern, text)
    
    # 감정 태그 제거하여 깨끗한 텍스트 생성
    cleaned_text = re.sub(emotion_pattern, '', text)
    cleaned_text = re.sub(r'\s+', ' ', cleaned_text).strip()
    
    return emotions, cleaned_text

def get_firebase_token():
    """Firebase 인증 토큰을 가져옵니다. 실패시 3초 대기 후 최대 3회 재시도."""
    global current_token
    
    # 현재 토큰이 있으면 재사용
    if current_token:
        return current_token
    
    # 현재 계정 정보 가져오기
    account = get_current_account()
    if not account:
        print("❌ 사용 가능한 계정이 없습니다.")
        return None
    
    firebase_email = account['email']
    firebase_password = account['password']
    firebase_api_key = os.getenv("FIREBASE_API_KEY")
    
    if not firebase_api_key:
        print("❌ FIREBASE_API_KEY가 .env 파일에 설정되지 않았습니다.")
        return None
    
    url = f"https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={firebase_api_key}"
    
    headers = {
        "Referer": "https://elevenlabs.io",
        "Origin": "https://elevenlabs.io",
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0"
    }
    
    payload = {
        "email": firebase_email,
        "password": firebase_password,
        "returnSecureToken": True
    }
    
    # 재시도 로직
    max_retries = 3
    retry_delay = 3
    
    for attempt in range(max_retries):
        try:
            r = requests.post(url, headers=headers, json=payload)
            if r.status_code == 200:
                token = r.json()['idToken']
                current_token = token
                print(f"✅ Token OK for {firebase_email}")
                return token
            else:
                print(f"❌ Firebase error [{r.status_code}]: {r.text}")
                if attempt < max_retries - 1:
                    print(f"🔄 {retry_delay}초 후 재시도... ({attempt + 1}/{max_retries})")
                    time.sleep(retry_delay)
        except requests.exceptions.RequestException as e:
            print(f"Network error: {e}")
            if attempt < max_retries - 1:
                print(f"🔄 {retry_delay}초 후 재시도... ({attempt + 1}/{max_retries})")
                time.sleep(retry_delay)
    
    print(f"❌ Firebase 인증 실패: {max_retries}회 재시도 후 실패")
    return None

def text_to_speech_v3(text, voice_id, emotions=None):
    """ElevenLabs v3 API를 사용하여 텍스트를 음성으로 변환합니다. 실패시 3초 대기 후 최대 3회 재시도."""
    global current_token
    
    # 계정 로테이션 확인
    if should_rotate_account():
        rotate_account()
    
    # 토큰 가져오기
    token = get_firebase_token()
    if not token:
        return None
    
    url = "https://api.us.elevenlabs.io/v1/text-to-dialogue/stream"
    
    # 감정 정보를 바탕으로 설정 조정 (TTD는 0.0, 0.5, 1.0만 허용)
    stability = 0.5  # Natural (기본값)
    if emotions:
        # 감정에 따라 안정성 조정
        if any(emotion in ['excited', 'dramatic', 'nervous'] for emotion in emotions):
            stability = 0.0  # Creative (더 다이나믹한 표현)
        elif any(emotion in ['whispers', 'serious', 'thoughtful'] for emotion in emotions):
            stability = 1.0  # Robust (더 안정적인 표현)
    
    headers = {
        "Accept": "audio/mpeg",
        "Content-Type": "application/json",
        "Origin": "https://elevenlabs.io",
        "Referer": "https://elevenlabs.io/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "authorization": f"Bearer {token}"
    }
    
    # TTS 요청 카운터 증가
    increment_tts_count()
    
    payload = {
        "inputs": [
            {
                "text": text,
                "voice_id": voice_id
            }
        ],
        "model_id": "eleven_v3",
        "settings": {
            "stability": stability,
            "use_speaker_boost": True
        }
    }
    
    # 재시도 로직
    max_retries = 5
    retry_delay = 15
    
    for attempt in range(max_retries):
        try:
            print(f"🔊 Sending request to ElevenLabs for voice_id: {voice_id}... (attempt {attempt + 1}/{max_retries})")
            r = requests.post(url, json=payload, headers=headers, stream=True)
            
            if r.status_code == 200:
                # 스트리밍 응답을 바이트로 수집
                audio_bytes = b""
                for chunk in r.iter_content(4096):
                    if chunk:
                        audio_bytes += chunk
                print("✅ Audio generated successfully")
                return audio_bytes
            else:
                print(f"❌ ElevenLabs error [{r.status_code}]:")
                try:
                    print(r.json())
                except json.JSONDecodeError:
                    print(r.text)
                
                if attempt < max_retries - 1:
                    print(f"🔄 {retry_delay}초 후 재시도... ({attempt + 1}/{max_retries})")
                    time.sleep(retry_delay)
                    
        except requests.exceptions.RequestException as e:
            print(f"Network error: {e}")
            if attempt < max_retries - 1:
                print(f"🔄 {retry_delay}초 후 재시도... ({attempt + 1}/{max_retries})")
                time.sleep(retry_delay)
    
    print(f"❌ ElevenLabs API 실패: {max_retries}회 재시도 후 실패")
    return None

def create_and_mix_audio(script):
    """대본을 기반으로 오디오를 생성하고 믹싱합니다."""
    if not script:
        return

    print("\n2. 대본을 기반으로 오디오를 생성하고 믹싱합니다...")

    # ElevenLabs 클라이언트 인스턴스 생성
    try:
        client = ElevenLabs(api_key=ELEVENLABS_API_KEY)
    except Exception as e:
        print(f"   - 에러: ElevenLabs 클라이언트 생성에 실패했습니다. API 키를 확인하세요. ({e})")
        return

    # 폴더 생성
    os.makedirs(GENERATED_AUDIO_PATH, exist_ok=True)
    os.makedirs(FINAL_PODCAST_PATH, exist_ok=True)

    # 최종 팟캐스트를 위한 빈 오디오 세그먼트 생성 (실제 길이는 동적으로 확장)
    # 프롬프트의 길이 제한은 가이드일 뿐, 실제 오디오는 끊기지 않도록 처리
    initial_duration_ms = 300000  # 5분으로 넉넉하게 설정
    final_podcast = AudioSegment.silent(duration=initial_duration_ms)

    # 대본의 각 세그먼트 처리
    previous_end_time = 0
    
    for i, segment in enumerate(script["segments"]):
        segment_type = segment["type"]
        start_time_ms = segment["start_time"] * 1000

        if segment_type == "dialogue":
            speaker = segment["speaker"]
            original_text = segment["text"]
            # 감정 태그 추출 및 텍스트 정리
            emotions, cleaned_text = extract_emotion_and_text(original_text)
            voice_id = VOICE_MAPPING.get(speaker)
            
            if not voice_id:
                print(f"   - 경고: '{speaker}'에 해당하는 목소리를 찾을 수 없습니다. 건너뜁니다.")
                continue

            print(f"   - '{speaker}'의 음성을 생성 중... ({i+1}/{len(script['segments'])})")
            
            try:
                # v3 API 사용하여 감정 표현이 포함된 음성 생성
                audio_bytes = text_to_speech_v3(cleaned_text, voice_id, emotions)
                
                if not audio_bytes:
                    # v3 API 실패 시 기존 API로 폴백
                    print(f"   - v3 API 실패, 기존 API로 폴백...")
                    audio_stream = client.text_to_speech.convert(
                        voice_id=voice_id,
                        text=cleaned_text,
                        voice_settings=VoiceSettings(
                            stability=0.5, 
                            similarity_boost=0.75, 
                            style=0.0, 
                            use_speaker_boost=True
                        )
                    )
                    audio_bytes = b"".join(audio_stream)
                
                # 생성된 오디오를 파일로 저장하고 Pydub로 로드
                segment_filename = os.path.join(GENERATED_AUDIO_PATH, f"segment_{i}_{speaker}.mp3")
                with open(segment_filename, "wb") as f:
                    f.write(audio_bytes)
                
                speech_segment = AudioSegment.from_mp3(segment_filename)
                
                # 겹침 방지: 이전 대사가 끝나는 시점 이후에 배치
                adjusted_start_time = max(start_time_ms, previous_end_time + 500)  # 0.5초 간격
                final_podcast = final_podcast.overlay(speech_segment, position=adjusted_start_time)
                
                # 다음 대사를 위한 종료 시점 계산
                previous_end_time = adjusted_start_time + len(speech_segment)

            except Exception as e:
                print(f"   - 에러: ElevenLabs 음성 생성에 실패했습니다. ({e})")


    # 최종 팟캐스트 파일 내보내기
    output_filename = os.path.join(FINAL_PODCAST_PATH, f"{script['title'].replace(' ', '_')}.mp3")
    print(f"\n3. 최종 팟캐스트 파일을 '{output_filename}'으로 저장합니다...")
    final_podcast.export(output_filename, format="mp3")
    print("   - 팟캐스트 생성 완료!")


# --- 메인 실행 ---

def main():
    """메인 실행 함수"""
    # 계정 로드
    if not load_accounts():
        print("❌ 계정 로드 실패. 프로그램을 종료합니다.")
        return
    
    # 1. 사용자 고민 입력
    concern = get_user_concern()
    if not concern:
        print("❌ 고민이 입력되지 않았습니다.")
        return
    
    # 2. 유사 사례 생성
    story_data = generate_similar_story(concern)
    if not story_data:
        print("❌ 유사 사례 생성에 실패했습니다.")
        return
    
    # 3. 상담 팟캐스트 대본 생성
    podcast_script = generate_podcast_script(concern, story_data)
    if not podcast_script:
        print("❌ 팟캐스트 대본 생성에 실패했습니다.")
        return
    
    # 4. 오디오 생성 및 믹싱
    create_and_mix_audio(podcast_script)

if __name__ == "__main__":
    main()
