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

// Voice mapping for ElevenLabs
const VOICE_MAPPING = {
  "진행자": "mgugV8tLa3KQE4mfYTw5",
  "남자게스트": "K3qo7ugXmpT87FDhLBbN",
  "여자게스트": "KlstlYt9VVf3zgie2Oht"
};

// Extract emotions from text
function extractEmotions(text: string): { emotions: string[], cleanText: string } {
  const emotionPattern = /\[([^\]]+)\]/g;
  const emotions: string[] = [];
  let match;
  
  while ((match = emotionPattern.exec(text)) !== null) {
    emotions.push(match[1]);
  }
  
  const cleanText = text.replace(emotionPattern, '').replace(/\s+/g, ' ').trim();
  return { emotions, cleanText };
}

// Account management for ElevenLabs
class AccountManager {
  private accounts: Array<{ email: string; password: string }> = [];
  private currentIndex = 0;
  private requestCount = 0;
  private currentToken: string | null = null;

  constructor(authFile: string = './auth.txt') {
    this.loadAccounts(authFile);
  }

  private loadAccounts(authFile: string) {
    if (!existsSync(authFile)) return;
    
    try {
      const content = readFileSync(authFile, 'utf-8');
      this.accounts = content.split('\n')
        .filter(line => line.includes(':'))
        .map(line => {
          const [email, password] = line.split(':');
          return { email: email.trim(), password: password.trim() };
        });
      console.log(`📋 Loaded ${this.accounts.length} accounts`);
    } catch (error) {
      console.error('Account loading error:', error);
    }
  }

  shouldRotate(): boolean {
    return this.requestCount >= 2;
  }

  rotate() {
    if (this.accounts.length === 0) return;
    this.currentIndex = (this.currentIndex + 1) % this.accounts.length;
    this.requestCount = 0;
    this.currentToken = null;
    console.log(`🔄 Account switch: ${this.accounts[this.currentIndex].email}`);
  }

  async getToken(): Promise<string | null> {
    if (this.currentToken) return this.currentToken;
    if (this.accounts.length === 0) return null;

    const account = this.accounts[this.currentIndex];
    const firebaseKey = process.env.FIREBASE_API_KEY;
    if (!firebaseKey) return null;

    try {
      const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${firebaseKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: account.email,
          password: account.password,
          returnSecureToken: true
        })
      });

      if (response.ok) {
        const data = await response.json();
        this.currentToken = data.idToken;
        console.log(`✅ Token obtained for ${account.email}`);
        return this.currentToken;
      }
    } catch (error) {
      console.error('Firebase auth error:', error);
    }
    return null;
  }

  incrementCount() {
    this.requestCount++;
  }
}

/**
 * Optimized Podcast Generation Service
 * Combines all functionality into a single, efficient service
 */
export class PodcastService {
  private prisma: PrismaClient;
  private genAI: GoogleGenerativeAI;
  private accountManager: AccountManager;
  private audioDir: string;

  constructor(prisma: PrismaClient, options: {
    audioDirectory?: string;
    authFile?: string;
  } = {}) {
    this.prisma = prisma;
    this.audioDir = options.audioDirectory || './audio';
    this.accountManager = new AccountManager(options.authFile);
    
    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) throw new Error('GEMINI_API_KEY not found');
    this.genAI = new GoogleGenerativeAI(geminiKey);
    
    // Ensure audio directories exist
    mkdirSync(join(this.audioDir, 'temp'), { recursive: true });
    mkdirSync(join(this.audioDir, 'final'), { recursive: true });
  }

  /**
   * Generate podcast script from situation
   */
  async generateScript(situation: string): Promise<PodcastScript | null> {
    const model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });
    
    const prompt = `
당신은 팟캐스트 대본 작가입니다. 주어진 상황에 대해 2분 이내의 대본을 작성하세요.

상황: "${situation}"

요구사항:
1. "진행자", "남자게스트", "여자게스트" 중 2-3명 사용
2. 감정 표현: [excited], [whispers], [cheerful] 등 사용
3. 시작 시간을 초 단위로 명시
4. JSON 형식으로 반환

JSON 형식:
{
  "title": "팟캐스트 제목",
  "total_duration_seconds": 120,
  "segments": [
    {
      "type": "dialogue",
      "speaker": "진행자",
      "text": "[cheerful] 안녕하세요!",
      "start_time": 2
    }
  ]
}`;

    try {
      const result = await model.generateContent(prompt);
      const responseText = result.response.text();
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        const script = JSON.parse(jsonMatch[0]);
        console.log('✅ Script generated:', script.title);
        return script;
      }
    } catch (error) {
      console.error('Script generation error:', error);
    }
    return null;
  }

  /**
   * Generate speech using ElevenLabs with extended timeout and retry logic
   */
  private async generateSpeech(text: string, voiceId: string, emotions: string[]): Promise<Buffer | null> {
    if (this.accountManager.shouldRotate()) {
      this.accountManager.rotate();
    }

    const token = await this.accountManager.getToken();
    if (!token) {
      // Fallback to API key
      return this.generateSpeechFallback(text, voiceId);
    }

    const stability = emotions.some(e => ['excited', 'dramatic'].includes(e)) ? 0.0 : 0.5;
    
    // Retry logic with extended timeout
    const maxRetries = 3;
    const retryDelay = 10000; // 10 seconds between retries
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        console.log(`🔊 Generating speech (attempt ${attempt + 1}/${maxRetries})...`);
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 minute timeout
        
        const response = await fetch('https://api.us.elevenlabs.io/v1/text-to-dialogue/stream', {
          method: 'POST',
          headers: {
            'Accept': 'audio/mpeg',
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            inputs: [{ text, voice_id: voiceId }],
            model_id: 'eleven_v3',
            settings: { stability, use_speaker_boost: true }
          }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);
        this.accountManager.incrementCount();

        if (response.ok) {
          const buffer = Buffer.from(await response.arrayBuffer());
          console.log('✅ Speech generated successfully');
          return buffer;
        } else {
          console.log(`❌ ElevenLabs API error [${response.status}]: ${await response.text()}`);
          if (attempt < maxRetries - 1) {
            console.log(`🔄 Retrying in ${retryDelay / 1000} seconds...`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
          }
        }
      } catch (error) {
        console.error(`ElevenLabs v3 error (attempt ${attempt + 1}):`, error);
        if (attempt < maxRetries - 1) {
          console.log(`🔄 Retrying in ${retryDelay / 1000} seconds...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
      }
    }

    console.log('⚠️ ElevenLabs v3 failed, trying fallback API...');
    return this.generateSpeechFallback(text, voiceId);
  }

  private async generateSpeechFallback(text: string, voiceId: string): Promise<Buffer | null> {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) return null;

    const maxRetries = 3;
    const retryDelay = 5000; // 5 seconds

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        console.log(`🔊 Fallback API (attempt ${attempt + 1}/${maxRetries})...`);
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 minute timeout
        
        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
          method: 'POST',
          headers: {
            'Accept': 'audio/mpeg',
            'Content-Type': 'application/json',
            'xi-api-key': apiKey
          },
          body: JSON.stringify({
            text,
            model_id: 'eleven_multilingual_v2',
            voice_settings: { stability: 0.5, similarity_boost: 0.75 }
          }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          console.log('✅ Speech generated (fallback)');
          return Buffer.from(await response.arrayBuffer());
        } else {
          console.log(`❌ Fallback API error [${response.status}]: ${await response.text()}`);
          if (attempt < maxRetries - 1) {
            console.log(`🔄 Retrying fallback in ${retryDelay / 1000} seconds...`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
          }
        }
      } catch (error) {
        console.error(`Fallback API error (attempt ${attempt + 1}):`, error);
        if (attempt < maxRetries - 1) {
          console.log(`🔄 Retrying fallback in ${retryDelay / 1000} seconds...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
      }
    }
    
    console.error('❌ All speech generation attempts failed');
    return null;
  }

  /**
   * Mix audio segments into final podcast
   */
  private async mixAudio(segments: Array<{ file: string; startTime: number }>, outputFile: string): Promise<boolean> {
    if (segments.length === 0) return false;

    try {
      console.log('🎵 Mixing audio segments...');
      
      // Simple concatenation for now
      const fileList = segments.map(s => `file '${s.file}'`).join('\n');
      const listFile = join(this.audioDir, 'temp', 'list.txt');
      writeFileSync(listFile, fileList);

      const command = `ffmpeg -f concat -safe 0 -i "${listFile}" -c copy -y "${outputFile}"`;
      execSync(command, { stdio: 'pipe' });
      
      console.log('✅ Audio mixed successfully');
      return true;
    } catch (error) {
      console.error('Audio mixing error:', error);
      
      // Fallback: copy first segment
      if (segments.length > 0) {
        try {
          execSync(`cp "${segments[0].file}" "${outputFile}"`);
          console.log('✅ Used first segment as fallback');
          return true;
        } catch (copyError) {
          console.error('Copy fallback error:', copyError);
        }
      }
      return false;
    }
  }

  /**
   * Generate complete podcast from situation
   */
  async generatePodcast(situation: string, channelId: number, userId: number, title?: string): Promise<GenerationResult> {
    console.log('🎙️ Starting podcast generation...');
    
    try {
      // 1. Generate script
      console.log('📝 Generating script...');
      const script = await this.generateScript(situation);
      if (!script) {
        return { success: false, error: 'Script generation failed' };
      }

      // 2. Generate audio segments
      console.log('🎵 Generating audio segments...');
      const audioSegments: Array<{ file: string; startTime: number }> = [];
      
      for (let i = 0; i < script.segments.length; i++) {
        const segment = script.segments[i];
        
        if (segment.type === 'dialogue') {
          const { emotions, cleanText } = extractEmotions(segment.text);
          const voiceId = VOICE_MAPPING[segment.speaker as keyof typeof VOICE_MAPPING];
          
          if (!voiceId) {
            console.warn(`Voice not found for: ${segment.speaker}`);
            continue;
          }

          console.log(`🔊 Generating audio ${i + 1}/${script.segments.length} for "${segment.speaker}"...`);
          const audioBuffer = await this.generateSpeech(cleanText, voiceId, emotions);
          
          if (audioBuffer) {
            const segmentFile = join(this.audioDir, 'temp', `segment_${i}.mp3`);
            writeFileSync(segmentFile, audioBuffer);
            audioSegments.push({
              file: segmentFile,
              startTime: segment.start_time * 1000
            });
          } else {
            console.warn(`⚠️ Failed to generate audio for segment ${i + 1}`);
          }
        }
      }

      if (audioSegments.length === 0) {
        return { success: false, error: 'No audio segments generated', script };
      }

      // 3. Mix audio
      console.log('🎛️ Mixing final audio...');
      const timestamp = Date.now();
      const finalFile = join(this.audioDir, 'final', `podcast_${timestamp}.mp3`);
      const mixSuccess = await this.mixAudio(audioSegments, finalFile);
      
      if (!mixSuccess) {
        return { success: false, error: 'Audio mixing failed', script };
      }

      // 4. Save to database
      console.log('💾 Saving to database...');
      const relativePath = `final/podcast_${timestamp}.mp3`;
      const snap = await this.prisma.snap.create({
        data: {
          title: title || script.title,
          duration: script.total_duration_seconds,
          views: 0,
          audio: relativePath,
          channelId,
          authorId: userId
        }
      });

      // 5. Save contexts
      await this.prisma.context.createMany({
        data: script.segments.map(segment => ({
          message: segment.text,
          timeline: segment.start_time,
          snapId: snap.id
        }))
      });

      // 6. Cleanup temp files
      console.log('🧹 Cleaning up temp files...');
      audioSegments.forEach(segment => {
        try {
          execSync(`rm -f "${segment.file}"`);
        } catch (e) {
          console.warn('Cleanup warning:', e);
        }
      });

      console.log(`✅ Podcast generated successfully: ${snap.id}`);
      return {
        success: true,
        snapId: snap.id,
        script,
        audioFile: finalFile
      };

    } catch (error) {
      console.error('Podcast generation error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Generate script only (no audio)
   */
  async generateScriptOnly(situation: string): Promise<PodcastScript | null> {
    return this.generateScript(situation);
  }

  /**
   * Get generation status
   */
  async getStatus(snapId: number) {
    try {
      const snap = await this.prisma.snap.findUnique({
        where: { id: snapId },
        include: {
          channel: { include: { author: { select: { id: true, name: true } } } },
          contexts: true
        }
      });

      if (!snap) return { status: 'not_found' };

      const audioExists = existsSync(join(this.audioDir, snap.audio));
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