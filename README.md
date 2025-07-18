# 🎙️ Snapcast Backend

A comprehensive TypeScript backend server for podcast generation and management using AI-powered script generation and text-to-speech conversion.

## 🚀 Features

- **AI-Powered Podcast Generation**: Generate complete podcasts from text situations using Gemini AI and ElevenLabs TTS
- **Multi-Language Support**: Korean podcast generation with natural dialogue and emotions
- **User Authentication**: JWT-based authentication with refresh tokens
- **Database Management**: Full CRUD operations with Prisma ORM
- **Audio Processing**: Audio streaming, uploading, and mixing with FFmpeg
- **Real-time Search**: AI-powered search and recommendations
- **API Documentation**: OpenAPI/Swagger documentation
- **Account Management**: ElevenLabs account rotation for API rate limiting

## 🛠️ Tech Stack

- **Runtime**: [Bun](https://bun.sh) - Fast JavaScript runtime
- **Framework**: [Elysia](https://elysiajs.com) - TypeScript web framework
- **Database**: SQLite with [Prisma](https://prisma.io) ORM
- **Authentication**: JWT tokens with cookie-based sessions
- **AI Integration**: Google Gemini AI for script generation
- **Text-to-Speech**: ElevenLabs API with v3 model support
- **Audio Processing**: FFmpeg for audio mixing and processing
- **Validation**: TypeBox for schema validation
- **Documentation**: Swagger/OpenAPI integration

## 📋 Prerequisites

- [Bun](https://bun.sh) v1.2.18 or higher
- [FFmpeg](https://ffmpeg.org) for audio processing
- Node.js 18+ (for compatibility)

### System Dependencies

```bash
# Ubuntu/Debian
sudo apt install ffmpeg

# macOS
brew install ffmpeg

# Verify installation
ffmpeg -version
```

## 🔧 Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd snapcast-backend
   ```

2. **Install dependencies**
   ```bash
   bun install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your API keys and configuration
   ```

4. **Set up database**
   ```bash
   bun run prisma generate
   bun run prisma migrate deploy
   ```

5. **Set up ElevenLabs accounts** (for audio generation)
   ```bash
   cp auth.txt.example auth.txt
   # Add your ElevenLabs account credentials
   ```

## 🔐 Environment Configuration

### Required Environment Variables

```env
# Server Configuration
PORT=8000
NODE_ENV=development
ALLOWED_ORIGINS="http://localhost:3000,https://yourdomain.com"

# Database
DATABASE_URL="file:./dev.db"

# JWT Configuration
JWT_SECRET="your-super-secret-jwt-key"
JWT_REFRESH_SECRET="your-super-secret-refresh-jwt-key"
ACCESS_TOKEN_EXPIRES_IN="15m"
REFRESH_TOKEN_EXPIRES_IN="7d"

# AI Services
GEMINI_API_KEY="your-gemini-api-key"
ELEVENLABS_API_KEY="your-elevenlabs-api-key"
FIREBASE_API_KEY="your-firebase-api-key"

# Audio Configuration
AUDIO_DIRECTORY="./audio"
ELEVENLABS_AUTH_FILE="./auth.txt"
AUDIO_GENERATION_TIMEOUT=300000
MAX_RETRY_ATTEMPTS=3
RETRY_DELAY=10000
```

### ElevenLabs Account Setup

Create `auth.txt` with multiple accounts for rotation:
```
user1@gmail.com:password123
user2@gmail.com:password456
user3@gmail.com:password789
```

## 🚀 Usage

### Development

```bash
# Start development server
bun run dev

# Start with hot reload
bun run src/index.ts

# Generate Prisma client
bun run prisma generate

# Run database migrations
bun run prisma migrate dev
```

### Production

```bash
# Build the application
bun run build

# Start production server
bun run start
```

## 📚 API Documentation

### Access Points

- **API Server**: `http://localhost:8000`
- **Swagger UI**: `http://localhost:8000/swagger`
- **OpenAPI JSON**: `http://localhost:8000/swagger/json`

### Core Endpoints

#### Authentication
- `POST /auth/register` - User registration
- `POST /auth/login` - User login
- `POST /auth/logout` - User logout
- `GET /auth/me` - Get current user
- `POST /auth/refresh` - Refresh access token

#### Podcast Generation
- `POST /podcast/generate` - Generate complete podcast (script + audio)
- `POST /podcast/script` - Generate script only
- `GET /podcast/status/:snapId` - Check generation status

#### Database Operations
- `GET /api/snaps` - List all snaps
- `POST /api/snaps` - Create new snap
- `GET /api/snaps/:id` - Get snap by ID
- `PUT /api/snaps/:id` - Update snap
- `DELETE /api/snaps/:id` - Delete snap

#### Audio Management
- `POST /audio/upload` - Upload audio file
- `GET /audio/stream/:filename` - Stream audio file

#### Search & Recommendations
- `GET /search` - AI-powered search
- `GET /recommended` - Get recommended snaps
- `GET /snap/:id` - Get snap details with related content

## 🎙️ Podcast Generation

### Script Generation

Generate Korean podcast scripts from text situations:

```bash
curl -X POST http://localhost:8000/podcast/script \
  -H "Content-Type: application/json" \
  -d '{"situation": "A conversation about morning routines"}'
```

### Full Podcast Generation

Generate complete podcasts with audio:

```bash
curl -X POST http://localhost:8000/podcast/generate \
  -H "Content-Type: application/json" \
  -d '{
    "situation": "A discussion about healthy eating",
    "channelId": 1,
    "title": "Healthy Living Tips"
  }'
```

### Voice Mapping

The system uses predefined Korean voices:
- **진행자** (Host): Professional voice
- **남자게스트** (Male Guest): Conversational male voice
- **여자게스트** (Female Guest): Conversational female voice

## 🏗️ Architecture

### Directory Structure

```
snapcast-backend/
├── src/
│   ├── index.ts              # Main server entry point
│   ├── podcast-service.ts    # Podcast generation logic
│   ├── podcast-router.ts     # Podcast API routes
│   ├── audio-stream.ts       # Audio streaming service
│   ├── audio-upload.ts       # Audio upload service
│   ├── ai-search.ts          # AI-powered search
│   ├── recommended-snaps.ts  # Recommendation engine
│   └── snap-detail.ts        # Snap detail service
├── packages/
│   ├── auth/                 # Authentication package
│   ├── database/             # Database operations
│   └── gemini/               # Gemini AI integration
├── prisma/
│   ├── schema.prisma         # Database schema
│   └── migrations/           # Database migrations
├── audio/
│   ├── temp/                 # Temporary audio files
│   └── final/                # Final podcast files
└── README-PODCAST.md         # Detailed podcast documentation
```

### Service Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │    │   Elysia API    │    │   Services      │
│   (React/Vue)   │◄──►│   Server        │◄──►│   Layer         │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │                        │
                                ▼                        ▼
                       ┌─────────────────┐    ┌─────────────────┐
                       │   Database      │    │   External      │
                       │   (SQLite)      │    │   APIs          │
                       └─────────────────┘    └─────────────────┘
```

## 🔌 Frontend Integration

### Authentication Flow

```typescript
// Login request
const response = await fetch('/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include', // Important for cookies
  body: JSON.stringify({ email, password })
});

// API requests with authentication
const apiResponse = await fetch('/api/snaps', {
  credentials: 'include' // Sends cookies automatically
});
```

### Frontend Code Guidelines

#### 1. API Communication

```typescript
// Use a centralized API client
class ApiClient {
  private baseURL = 'http://localhost:8000';
  
  async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseURL}${endpoint}`, {
      ...options,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
    
    if (!response.ok) {
      throw new Error(`API Error: ${response.status}`);
    }
    
    return response.json();
  }
}
```

#### 2. Type Safety

```typescript
// Define TypeScript interfaces matching backend schemas
interface PodcastScript {
  title: string;
  total_duration_seconds: number;
  segments: Array<{
    type: string;
    speaker: string;
    text: string;
    start_time: number;
  }>;
}

interface GenerationResult {
  success: boolean;
  snapId?: number;
  script?: PodcastScript;
  audioFile?: string;
  error?: string;
}
```

#### 3. Error Handling

```typescript
// Centralized error handling
const handleApiError = (error: any) => {
  if (error.status === 401) {
    // Redirect to login
    window.location.href = '/login';
  } else if (error.status === 500) {
    // Show server error message
    showErrorToast('Server error. Please try again.');
  }
};
```

#### 4. Real-time Updates

```typescript
// Poll for podcast generation status
const pollPodcastStatus = async (snapId: number) => {
  const interval = setInterval(async () => {
    try {
      const status = await apiClient.request(`/podcast/status/${snapId}`);
      if (status.data.status === 'completed') {
        clearInterval(interval);
        // Handle completion
      }
    } catch (error) {
      clearInterval(interval);
      handleApiError(error);
    }
  }, 5000);
};
```

## 🧪 Testing

### Manual Testing

```bash
# Test health endpoint
curl http://localhost:8000/health

# Test with authentication
curl -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "password": "Password123"}' \
  -c cookies.txt

# Test podcast generation
curl -X POST http://localhost:8000/podcast/script \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"situation": "A conversation about technology"}'
```

### Performance Testing

The system handles:
- **Script Generation**: ~30 seconds
- **Audio Generation**: 1-5 minutes per segment
- **Concurrent Requests**: Managed by account rotation
- **File Size**: Up to 500MB audio files

## 🔍 Troubleshooting

### Common Issues

1. **Audio Generation Fails**
   - Check ElevenLabs API keys in `.env`
   - Verify `auth.txt` has valid accounts
   - Ensure FFmpeg is installed

2. **Database Errors**
   - Run `bun run prisma generate`
   - Check database file permissions
   - Verify schema migrations

3. **Authentication Issues**
   - Check JWT secrets in `.env`
   - Verify cookie settings
   - Test with Postman/curl

### Debugging

```bash
# Enable verbose logging
DEBUG=podcast:* bun run src/index.ts

# Check database schema
bun run prisma studio

# Validate environment variables
bun run -e "console.log(process.env.GEMINI_API_KEY)"
```

## 📊 Monitoring & Analytics

### Health Checks

- `GET /health` - Basic health status
- Monitor database connections
- Track API response times
- Monitor audio generation success rates

### Logging

The system provides comprehensive logging:
- Request/response logging
- Error tracking
- Performance metrics
- Audio generation progress

## 🔒 Security

### Best Practices

- JWT tokens with short expiration
- HTTP-only cookies for session management
- Environment variable protection
- Input validation with TypeBox
- Rate limiting for API endpoints

### Production Deployment

```bash
# Environment variables
NODE_ENV=production
ALLOWED_ORIGINS="https://yourdomain.com"

# Security headers
# Configure reverse proxy (nginx/cloudflare)
# Enable HTTPS
# Set up monitoring
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📝 License

This project is licensed under the MIT License.

## 🆘 Support

For issues and questions:
- Check the troubleshooting section
- Review the API documentation
- Create an issue in the repository

---

**Built with ❤️ using Bun, Elysia, and modern TypeScript**