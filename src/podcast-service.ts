import { GoogleGenerativeAI } from '@google/generative-ai';
import { PrismaClient } from '@prisma/client';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

// Core interfaces
export interface PodcastScript {
  title: string;
  total_duration_seconds: number;
  segments: Array<{
    type: string;
    speaker: string;
    text: string;
    start_time: number;
  }>;
}

export interface GenerationResult {
  success: boolean;
  snapId?: number;
  script?: PodcastScript;
  audioFile?: string;
  error?: string;
}

// Voice mapping for ElevenLabs (exactly as in Python)
const VOICE_MAPPING = {
  "진행자": "mgugV8tLa3KQE4mfYTw5",
  "남자게스트": "K3qo7ugXmpT87FDhLBbN",
  "여자게스트": "KlstlYt9VVf3zgie2Oht"
};

// Extract emotions from text (exactly as in Python)
function extractEmotionAndText(text: string): { emotions: string[], cleanedText: string } {
  const emotionPattern = /\[([^\]]+)\]/g;
  const emotions: string[] = [];
  let match;
  
  while ((match = emotionPattern.exec(text)) !== null) {
    emotions.push(match[1]);
  }
  
  const cleanedText = text.replace(emotionPattern, '').replace(/\s+/g, ' ').trim();
  return { emotions, cleanedText };
}

// Account management system (exactly as in Python)
class AccountManager {
  private accounts: Array<{ email: string; password: string }> = [];
  private currentAccountIndex = 0;
  private ttsRequestCount = 0;
  private currentToken: string | null = null;

  constructor(authFilePath: string = './auth.txt') {
    this.loadAccounts(authFilePath);
  }

  private loadAccounts(authFilePath: string): boolean {
    try {
      if (!existsSync(authFilePath)) {
        console.log(`❌ ${authFilePath} 파일을 찾을 수 없습니다.`);
        return false;
      }

      const content = readFileSync(authFilePath, 'utf-8');
      this.accounts = [];
      
      const lines = content.split('\n');
      for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine && trimmedLine.includes(':')) {
          const [email, password] = trimmedLine.split(':', 2);
          this.accounts.push({
            email: email.trim(),
            password: password.trim()
          });
        }
      }

      console.log(`📋 ${this.accounts.length}개의 계정을 로드했습니다.`);
      return this.accounts.length > 0;
    } catch (error) {
      console.error(`❌ 계정 로드 중 오류: ${error}`);
      return false;
    }
  }

  getCurrentAccount(): { email: string; password: string } | null {
    if (this.accounts.length === 0) return null;
    return this.accounts[this.currentAccountIndex];
  }

  rotateAccount(): void {
    this.currentAccountIndex = (this.currentAccountIndex + 1) % this.accounts.length;
    this.ttsRequestCount = 0;
    this.currentToken = null;
    const account = this.getCurrentAccount();
    if (account) {
      console.log(`🔄 계정 전환: ${account.email}`);
    }
  }

  shouldRotateAccount(): boolean {
    return this.ttsRequestCount >= 2;
  }

  incrementTtsCount(): void {
    this.ttsRequestCount++;
    console.log(`📊 현재 계정 TTS 요청 수: ${this.ttsRequestCount}/2`);
  }

  // Firebase authentication (exactly as in Python)
  async getFirebaseToken(): Promise<string | null> {
    // 현재 토큰이 있으면 재사용
    if (this.currentToken) {
      return this.currentToken;
    }

    // 현재 계정 정보 가져오기
    const account = this.getCurrentAccount();
    if (!account) {
      console.log("❌ 사용 가능한 계정이 없습니다.");
      return null;
    }

    const firebaseApiKey = process.env.FIREBASE_API_KEY;
    if (!firebaseApiKey) {
      console.log("❌ FIREBASE_API_KEY가 .env 파일에 설정되지 않았습니다.");
      return null;
    }

    const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${firebaseApiKey}`;
    
    const headers = {
      "Referer": "https://elevenlabs.io",
      "Origin": "https://elevenlabs.io",
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0"
    };

    const payload = {
      email: account.email,
      password: account.password,
      returnSecureToken: true
    };

    // 재시도 로직 (exactly as in Python)
    const maxRetries = 3;
    const retryDelay = 3000; // 3초

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload)
        });

        if (response.status === 200) {
          const data = await response.json();
          this.currentToken = data.idToken;
          console.log(`✅ Token OK for ${account.email}`);
          return this.currentToken;
        } else {
          const errorText = await response.text();
          console.log(`❌ Firebase error [${response.status}]: ${errorText}`);
          if (attempt < maxRetries - 1) {
            console.log(`🔄 ${retryDelay / 1000}초 후 재시도... (${attempt + 1}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
          }
        }
      } catch (error) {
        console.log(`Network error: ${error}`);
        if (attempt < maxRetries - 1) {
          console.log(`🔄 ${retryDelay / 1000}초 후 재시도... (${attempt + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
      }
    }

    console.log(`❌ Firebase 인증 실패: ${maxRetries}회 재시도 후 실패`);
    return null;
  }
}

/**
 * Podcast Generation Service - Exactly matching Python logic
 */
export class PodcastService {
  private prisma: PrismaClient;
  private genAI: GoogleGenerativeAI;
  private accountManager: AccountManager;
  private audioDir: string;
  private generatedAudioPath: string;
  private finalPodcastPath: string;

  constructor(prisma: PrismaClient, options: {
    audioDirectory?: string;
    authFile?: string;
  } = {}) {
    this.prisma = prisma;
    this.audioDir = options.audioDirectory || './audio';
    this.generatedAudioPath = join(this.audioDir, 'temp');
    this.finalPodcastPath = join(this.audioDir, 'final');
    
    // Load accounts from auth.txt
    this.accountManager = new AccountManager(options.authFile || './auth.txt');
    
    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) throw new Error('GEMINI_API_KEY not found');
    this.genAI = new GoogleGenerativeAI(geminiKey);
    
    // 폴더 생성
    mkdirSync(this.generatedAudioPath, { recursive: true });
    mkdirSync(this.finalPodcastPath, { recursive: true });
  }

  /**
   * Generate podcast script (exactly as in Python)
   */
  async generatePodcastScript(situation: string): Promise<PodcastScript | null> {
    console.log("1. Gemini API를 사용하여 팟캐스트 대본을 생성합니다...");

    // Gemini 모델 설정 (exactly as in Python)
    const model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });

    // Gemini에게 보낼 프롬프트 (exactly as in Python)
    const prompt = `
당신은 짧은 오디오 팟캐스트 대본을 작성하는 전문 작가입니다.
주어진 상황에 대해 2분(120초) 이내의 흥미로운 대본을 작성해주세요.

상황: "${situation}"

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
`;

    try {
      const response = await model.generateContent(prompt);
      const responseText = response.response.text();
      
      // 모델 응답에서 JSON 부분만 추출
      const jsonText = responseText.trim().replace(/```json/g, "").replace(/```/g, "");
      const script = JSON.parse(jsonText);
      
      console.log("   - 대본 생성 완료.");
      return script;
    } catch (error) {
      console.log(`   - 에러: 대본 생성에 실패했습니다. Gemini API 응답을 확인하세요. (${error})`);
      return null;
    }
  }

  /**
   * Text to Speech using ElevenLabs v3 API (exactly as in Python)
   */
  async textToSpeechV3(text: string, voiceId: string, emotions: string[] = []): Promise<Buffer | null> {
    // 계정 로테이션 확인
    if (this.accountManager.shouldRotateAccount()) {
      this.accountManager.rotateAccount();
    }

    // 토큰 가져오기
    const token = await this.accountManager.getFirebaseToken();
    if (!token) {
      return null;
    }

    const url = "https://api.us.elevenlabs.io/v1/text-to-dialogue/stream";

    // 감정 정보를 바탕으로 설정 조정 (TTD는 0.0, 0.5, 1.0만 허용)
    let stability = 0.5; // Natural (기본값)
    if (emotions.length > 0) {
      // 감정에 따라 안정성 조정
      if (emotions.some(emotion => ['excited', 'dramatic', 'nervous'].includes(emotion))) {
        stability = 0.0; // Creative (더 다이나믹한 표현)
      } else if (emotions.some(emotion => ['whispers', 'serious', 'thoughtful'].includes(emotion))) {
        stability = 1.0; // Robust (더 안정적인 표현)
      }
    }

    const headers = {
      "Accept": "audio/mpeg",
      "Content-Type": "application/json",
      "Origin": "https://elevenlabs.io",
      "Referer": "https://elevenlabs.io/",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      "authorization": `Bearer ${token}`
    };

    // TTS 요청 카운터 증가
    this.accountManager.incrementTtsCount();

    const payload = {
      inputs: [
        {
          text: text,
          voice_id: voiceId
        }
      ],
      model_id: "eleven_v3",
      settings: {
        stability: stability,
        use_speaker_boost: true
      }
    };

    // 재시도 로직 (exactly as in Python)
    const maxRetries = 5;
    const retryDelay = 15000; // 15초

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        console.log(`🔊 Sending request to ElevenLabs for voice_id: ${voiceId}... (attempt ${attempt + 1}/${maxRetries})`);
        
        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload)
        });

        if (response.status === 200) {
          const audioBuffer = Buffer.from(await response.arrayBuffer());
          console.log("✅ Audio generated successfully");
          return audioBuffer;
        } else {
          console.log(`❌ ElevenLabs error [${response.status}]:`);
          try {
            const errorJson = await response.json();
            console.log(errorJson);
          } catch {
            const errorText = await response.text();
            console.log(errorText);
          }

          if (attempt < maxRetries - 1) {
            console.log(`🔄 ${retryDelay / 1000}초 후 재시도... (${attempt + 1}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
          }
        }
      } catch (error) {
        console.log(`Network error: ${error}`);
        if (attempt < maxRetries - 1) {
          console.log(`🔄 ${retryDelay / 1000}초 후 재시도... (${attempt + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
      }
    }

    console.log(`❌ ElevenLabs API 실패: ${maxRetries}회 재시도 후 실패`);
    return null;
  }

  /**
   * Create and mix audio (exactly as in Python logic)
   */
  async createAndMixAudio(script: PodcastScript): Promise<string | null> {
    if (!script) return null;

    console.log("\\n2. 대본을 기반으로 오디오를 생성하고 믹싱합니다...");

    // 오디오 세그먼트들을 저장할 배열
    const audioSegments: Array<{ file: string; startTime: number; duration: number }> = [];
    let previousEndTime = 0;

    // 대본의 각 세그먼트 처리
    for (let i = 0; i < script.segments.length; i++) {
      const segment = script.segments[i];
      const segmentType = segment.type;
      const startTimeMs = segment.start_time * 1000;

      if (segmentType === "dialogue") {
        const speaker = segment.speaker;
        const originalText = segment.text;
        
        // 감정 태그 추출 및 텍스트 정리
        const { emotions, cleanedText } = extractEmotionAndText(originalText);
        const voiceId = VOICE_MAPPING[speaker as keyof typeof VOICE_MAPPING];

        if (!voiceId) {
          console.log(`   - 경고: '${speaker}'에 해당하는 목소리를 찾을 수 없습니다. 건너뜁니다.`);
          continue;
        }

        console.log(`   - '${speaker}'의 음성을 생성 중... (${i + 1}/${script.segments.length})`);

        try {
          // v3 API 사용하여 감정 표현이 포함된 음성 생성
          const audioBytes = await this.textToSpeechV3(cleanedText, voiceId, emotions);

          if (!audioBytes) {
            console.log(`   - v3 API 실패, 세그먼트 ${i + 1} 건너뜀`);
            continue;
          }

          // 생성된 오디오를 파일로 저장
          const segmentFilename = join(this.generatedAudioPath, `segment_${i}_${speaker}.mp3`);
          writeFileSync(segmentFilename, audioBytes);

          // 겹침 방지: 이전 대사가 끝나는 시점 이후에 배치
          const adjustedStartTime = Math.max(startTimeMs, previousEndTime + 500); // 0.5초 간격
          
          // 오디오 길이 추정 (실제로는 ffprobe로 정확히 측정해야 함)
          const estimatedDuration = cleanedText.length * 100; // 대략적인 추정
          
          audioSegments.push({
            file: segmentFilename,
            startTime: adjustedStartTime,
            duration: estimatedDuration
          });

          // 다음 대사를 위한 종료 시점 계산
          previousEndTime = adjustedStartTime + estimatedDuration;

        } catch (error) {
          console.log(`   - 에러: ElevenLabs 음성 생성에 실패했습니다. (${error})`);
        }
      }
    }

    if (audioSegments.length === 0) {
      console.log("❌ 생성된 오디오 세그먼트가 없습니다.");
      return null;
    }

    // Generate temporary filename first, will rename after getting snap ID
    const tempFilename = join(this.finalPodcastPath, `temp_${Date.now()}.mp3`);
    console.log(`\\n3. 최종 팟캐스트 파일을 임시로 생성합니다...`);

    try {
      // 단순히 첫 번째 세그먼트를 복사하거나 연결
      if (audioSegments.length === 1) {
        // 하나의 세그먼트만 있는 경우
        execSync(`cp "${audioSegments[0].file}" "${tempFilename}"`);
      } else {
        // 여러 세그먼트를 연결 (순차적으로)
        const inputFiles = audioSegments.map(seg => `"${seg.file}"`).join(' ');
        execSync(`ffmpeg -i "concat:${audioSegments.map(seg => seg.file).join('|')}" -acodec copy -y "${tempFilename}" 2>/dev/null || cat ${inputFiles} > "${tempFilename}"`);
      }

      console.log("   - 임시 팟캐스트 파일 생성 완료!");
      return tempFilename;
    } catch (error) {
      console.log(`   - 에러: 오디오 믹싱에 실패했습니다. (${error})`);
      
      // 폴백: 첫 번째 세그먼트만 사용
      if (audioSegments.length > 0) {
        try {
          execSync(`cp "${audioSegments[0].file}" "${tempFilename}"`);
          console.log("   - 첫 번째 세그먼트만 사용하여 저장 완료");
          return tempFilename;
        } catch (copyError) {
          console.log(`   - 복사 실패: ${copyError}`);
        }
      }
      return null;
    }
  }

  /**
   * Generate complete podcast
   */
  async generatePodcast(situation: string, channelId: number, userId: number, title?: string): Promise<GenerationResult> {
    console.log('🎙️ Starting podcast generation...');
    console.log('📝 Generating script...');
    
    try {
      // 1. 대본 생성
      const script = await this.generatePodcastScript(situation);
      if (!script) {
        return { success: false, error: 'Script generation failed' };
      }

      console.log(`✅ Script generated: ${script.title}`);

      // 2. 오디오 생성 및 믹싱
      const tempAudioFile = await this.createAndMixAudio(script);
      if (!tempAudioFile) {
        return { success: false, error: 'No audio segments generated', script };
      }

      // 3. 데이터베이스에 저장 (먼저 저장하여 ID 얻기)
      const snap = await this.prisma.snap.create({
        data: {
          title: title || script.title,
          duration: script.total_duration_seconds,
          views: 0,
          audio: `final/podcast_${0}.mp3`, // 임시 경로, 아래에서 업데이트
          channelId,
          authorId: userId
        }
      });

      // 4. 파일을 ID 기반 이름으로 변경
      const finalAudioFile = join(this.finalPodcastPath, `podcast_${snap.id}.mp3`);
      execSync(`mv "${tempAudioFile}" "${finalAudioFile}"`);
      
      // 5. 데이터베이스의 오디오 경로 업데이트
      await this.prisma.snap.update({
        where: { id: snap.id },
        data: { audio: `final/podcast_${snap.id}.mp3` }
      });

      console.log(`✅ 최종 파일: podcast_${snap.id}.mp3`);

      // 6. 컨텍스트 저장
      await this.prisma.context.createMany({
        data: script.segments.map(segment => ({
          message: segment.text,
          timeline: segment.start_time,
          snapId: snap.id
        }))
      });

      console.log(`✅ Podcast generated successfully: ${snap.id}`);
      return {
        success: true,
        snapId: snap.id,
        script,
        audioFile: finalAudioFile
      };

    } catch (error) {
      console.error('Podcast generation error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Generate script only
   */
  async generateScriptOnly(situation: string): Promise<PodcastScript | null> {
    console.log('📝 Generating script...');
    const script = await this.generatePodcastScript(situation);
    if (script) {
      console.log(`✅ Script generated: ${script.title}`);
    }
    return script;
  }

  /**
   * Get status
   */
  async getStatus(snapId: number) {
    try {
      const snap = await this.prisma.snap.findUnique({
        where: { id: snapId },
        include: {
          channel: { include: { author: { select: { id: true, name: true, avatar: true } } } },
          contexts: true
        }
      });

      if (!snap) return { status: 'not_found' };

      const audioPath = join(this.audioDir, snap.audio);
      const audioExists = existsSync(audioPath);
      
      return {
        status: audioExists ? 'completed' : 'processing',
        snap,
        audioExists
      };
    } catch (error) {
      return { status: 'error', error: error.message };
    }
  }
}