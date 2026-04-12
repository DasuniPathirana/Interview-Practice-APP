export interface DetectedQuestion {
  id: string;
  text: string;
  source: 'voice' | 'screen';
  confidence: number;
  timestamp: string;
}

export interface AISuggestion {
  questionId: string;
  question: string;
  answer: string;
  model: string;
  timestamp: string;
}

export interface SessionConfig {
  interviewType: string;
  jobRole: string;
  difficulty: string;
}
