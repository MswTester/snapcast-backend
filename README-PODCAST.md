# Podcast Generation System

## Overview
This system generates complete podcasts from text situations using:
- **Gemini AI** for script generation
- **ElevenLabs** for text-to-speech
- **FFmpeg** for audio mixing

## Setup

### 1. Environment Variables
Copy `.env.example` to `.env` and configure:

```bash
# Required
GEMINI_API_KEY="your-gemini-api-key"
ELEVENLABS_API_KEY="your-elevenlabs-api-key"
FIREBASE_API_KEY="your-firebase-api-key"

# Optional
AUDIO_DIRECTORY="./audio"
ELEVENLABS_AUTH_FILE="./auth.txt"
```

### 2. ElevenLabs Account Setup
Create `auth.txt` file with multiple accounts for rotation:
```
user1@gmail.com:password123
user2@gmail.com:password456
user3@gmail.com:password789
```

### 3. Dependencies
Install system dependencies:
```bash
# Ubuntu/Debian
sudo apt install ffmpeg

# macOS
brew install ffmpeg

# Verify installation
ffmpeg -version
```

## API Endpoints

### Generate Complete Podcast
```bash
POST /podcast/generate
Content-Type: application/json

{
  "situation": "A conversation about AI technology",
  "channelId": 1,
  "title": "Optional custom title"
}
```

### Generate Script Only
```bash
POST /podcast/script
Content-Type: application/json

{
  "situation": "A discussion about climate change"
}
```

### Check Generation Status
```bash
GET /podcast/status/:snapId
```

## Voice Mapping
The system uses predefined Korean voices:
- **진행자** (Host): Professional voice
- **남자게스트** (Male Guest): Conversational male voice  
- **여자게스트** (Female Guest): Conversational female voice

## Audio Generation Process

### 1. Script Generation (30-60 seconds)
- Uses Gemini AI to create dialogue
- Includes emotion tags: `[excited]`, `[whispers]`, `[cheerful]`
- Generates 2-minute podcast format

### 2. Audio Generation (1-5 minutes per segment)
- **Timeout**: 5 minutes per segment
- **Retry Logic**: 3 attempts with 10-second delays
- **Fallback**: Uses API key if Firebase auth fails
- **Account Rotation**: Switches accounts every 2 requests

### 3. Audio Mixing (10-30 seconds)
- Combines all segments using FFmpeg
- Handles timing and overlap prevention
- Fallback to concatenation if mixing fails

## Error Handling

### Common Issues
1. **Script Generation Failed**: Check Gemini API key
2. **Audio Generation Timeout**: Increase timeout or check network
3. **Account Rotation**: Add more accounts to auth.txt
4. **Audio Mixing Failed**: Check FFmpeg installation

### Debugging
Enable verbose logging by setting:
```bash
DEBUG=podcast:*
```

## Performance Optimization

### Account Management
- Use 3+ ElevenLabs accounts for rotation
- Each account handles 2 requests before switching
- Automatic token refresh and error recovery

### Timeout Configuration
- Default: 5 minutes per audio segment
- Configurable via `AUDIO_GENERATION_TIMEOUT`
- Automatic retry with exponential backoff

### Resource Management
- Automatic cleanup of temporary files
- Efficient memory usage for large audio files
- Proper error handling and recovery

## File Structure
```
audio/
├── temp/           # Temporary audio segments
├── final/          # Final podcast files
└── *.mp3          # Generated podcasts

auth.txt           # ElevenLabs account credentials
.env              # Environment configuration
```

## Security Notes
- Never commit `auth.txt` to version control
- Use environment variables for sensitive data
- Rotate API keys regularly
- Monitor API usage and costs

## Troubleshooting

### Audio Generation Takes Too Long
- Check internet connection
- Verify ElevenLabs API status
- Add more accounts to auth.txt
- Increase timeout values

### Poor Audio Quality
- Check voice ID mapping
- Verify emotion tags format
- Test with simpler text first
- Check ElevenLabs voice settings

### Database Errors
- Verify channel and user IDs exist
- Check database connection
- Ensure proper permissions
- Review Prisma schema

## API Response Examples

### Successful Generation
```json
{
  "data": {
    "success": true,
    "snapId": 123,
    "script": {
      "title": "AI Technology Discussion",
      "total_duration_seconds": 120,
      "segments": [...]
    },
    "audioFile": "./audio/final/podcast_1234567890.mp3"
  }
}
```

### Generation Error
```json
{
  "data": {
    "success": false,
    "error": "Audio generation failed",
    "script": {...}
  }
}
```