

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
    "남자게스트": "K3qo7ugXmpT87FDhLBbN",
    "여자게스트": "KlstlYt9VVf3zgie2Oht"
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

# --- 1. 대본 생성 (Gemini) ---

def generate_podcast_script(situation):
    """Gemini API를 사용하여 팟캐스트 대본을 생성합니다."""
    print("1. Gemini API를 사용하여 팟캐스트 대본을 생성합니다...")

    # Gemini 모델 설정
    model = genai.GenerativeModel('gemini-2.5-pro')

    # Gemini에게 보낼 프롬프트
    prompt = f"""
당신은 짧은 오디오 팟캐스트 대본을 작성하는 전문 작가입니다.
주어진 상황에 대해 2분(120초) 이내의 흥미로운 대본을 작성해주세요.

상황: "{situation}"

요구사항:
1. '진행자'와 '게스트'라는 두 명의 화자를 등장시켜주세요.
2, ["진행자", "남자게스트", "여자게스트"] 이 세명만 사용해야합니다. 절대 다른건 사용 불가합니다. 진행자를 포함하여 최소 2개의 역할을 적절히 사용해야합니다.
3. 각 대사와 효과음의 시작 시간(start_time)을 초 단위로 정확히 명시해주세요.
4. 대사에는 ElevenLabs의 감정 표현 기능을 활용하여 대괄호 [] 안에 감정이나 톤을 명시해주세요.
   - 예시: [excited], [whispers], [sarcastically], [giggles], [dramatic], [confused], [cheerful], [mysterious], [nervous], [confident] 등
5. 감정 표현은 자연스럽게 대화의 흐름에 맞게 배치해주세요.
6. 결과는 반드시 아래의 JSON 형식으로 반환해주세요.

사용 가능한 감정 표현 예시:
- [excited] - 흥분된, 신난
- [whispers] - 속삭이는
- [sarcastically] - 비꼬는, 빈정거리는
- [giggles] - 킥킥 웃는
- [dramatic] - 극적인, 드라마틱한
- [confused] - 혼란스러운
- [cheerful] - 명랑한, 쾌활한
- [mysterious] - 신비로운
- [nervous] - 긴장한, 불안한
- [confident] - 자신감 있는
- [thoughtful] - 사려깊은
- [surprised] - 놀란
- [worried] - 걱정스러운
- [amused] - 재미있어하는
- [serious] - 진지한

JSON 형식:
{{
  "title": "팟캐스트 제목",
  "total_duration_seconds": 110,
  "segments": [
    {{
      "type": "dialogue",
      "speaker": "진행자",
      "text": "[cheerful] 안녕하세요, 기술과 인간이 만나는 곳, 'AI 쇼'에 오신 것을 환영합니다!",
      "start_time": 2
    }},
    {{
      "type": "dialogue",
      "speaker": "AI",
      "text": "[confident] 안녕하세요, 진행자님. [giggles] 오늘 초대해주셔서 감사합니다.",
      "start_time": 8
    }},
    {{
      "type": "dialogue",
      "speaker": "진행자",
      "text": "[mysterious] 오늘은 정말 특별한 이야기를 들려드릴 예정입니다. [whispers] 여러분도 준비되셨나요?",
      "start_time": 12
    }}
  ]
}}

주의사항:
- 감정 표현은 대사의 시작 부분이나 중간에 자연스럽게 배치하세요.
- 한 대사에 여러 감정을 사용할 수 있지만, 과도하게 사용하지 마세요.
- 상황과 맥락에 맞는 적절한 감정을 선택하세요.
- 대화의 흐름이 자연스럽게 이어지도록 구성하세요.
"""

    try:
        response = model.generate_content(prompt)
        # 모델 응답에서 JSON 부분만 추출
        json_text = response.text.strip().replace("```json", "").replace("```", "")
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
    
    # 팟캐스트 주제 설정
    situation = """{   "story": "저는 올해 고3을 맞이하는 평범한 학생입니다. 저는 작년 12월에 제 친구가 저랑 같이 찍은 사진을 인스타 스토리에 올렸습니다. 그러고나서 제 친구 여사친이 그 스토리를 보고 저를 소개해달라고 하였습니다. 그렇게 저희는 소개팅이 잡히게 되었고, 그해 겨울 저희는 총 5명(스토리 주인, 원래 여사친 친구, 소개팅녀, 저, 소개팅녀 친구)이서 노래방에서 만나게 되었어요. 우린 서로 되게 낯을 많이 가리는 성격이라 눈을 쳐다보지 못했어요. 근데 친구들의 도움덕에 눈맞춤도 트고, 말도 텄어요. 그렇게 다음 약속을 기약하며 다음엔 단둘이서 만났어요. 그렇게 이제 서로 농담도 던지고 어느정도 친해지면서 (친구)집데이트도 하면서 서로 호감을 확인하고 가까워졌어요. 결국 제가 먼저 밤거리에 걸어가면서 '나랑 사귈래?'라고 했고, 그녀는 알겠다고 했어요. 그렇게 저희는 사귀게 되었지만, 갑자기 데이트한 다음날 그녀가 저를 찼어요. 온 세상이 무너진 기분이 들고 되게 우울해서 친구들과 새벽까지 통화를 하며 울분을 토했지만, 그녀는 돌아오지 않았어요 ㅜㅜㅜㅜㅜ. 2주 사귀고 헤어지게 되었고, 그녀가 제 첫 여친이었어요. 저는 아직도 그녀를 못잊고 가끔은 친구들 앞에서 말도 자주 꺼내면서 살고 있네요.",   "questions": [     {       "question": "그때 그 방의 냄새는 어땠나요? 혹시 특정한 향이 났다면, 그 냄새를 맡았을 때 어떤 느낌이 들었는지 묘사해주실 수 있나요?",       "answer": "친구 방이어서 그저 그랬던 것 같아요. 그래도 친구 침대에서 그녀와 함께 누웠을때 되게 좋았어요."     },     {       "question": "그 사람이 당신에게 했던 말 중에서 정확히 어떤 문장이 가장 기억에 남나요? 그 문장을 다시 한번 말해주실 수 있나요? 그리고 그 문장을 들었을 때, 당신의 즉각적인 반응은 어떠했나요?",       "answer": "말은 아니었지만, 행동으로 제가 손을 잡을때 그녀는 눈을 피했어요. 그때 너무 귀엽더라고요 ㅋ"     },     {       "question": "그 물건을 손에 쥐었을 때 어떤 감촉이었나요? 차가웠나요, 따뜻했나요? 부드러웠나요, 거칠었나요? 그리고 그 물건을 쥐고 있는 동안 어떤 생각이 들었나요?",       "answer": "흥분했어요"     },     {       "question": "그 결정을 내리기 직전, 당신의 머릿속에 어떤 생각들이 스쳐 지나갔나요? 마치 영화의 한 장면처럼, 그 순간의 생각들을 자세히 묘사해주실 수 있나요?",       "answer": "너무 좋아서 빨리 사귀고 싶었죠."     }   ],   "title": "첫사랑 이야기" }"""
    # 1. 대본 생성
    podcast_script = generate_podcast_script(situation)

    # 2. 오디오 생성 및 믹싱
    if podcast_script:
        create_and_mix_audio(podcast_script)

if __name__ == "__main__":
    main()
