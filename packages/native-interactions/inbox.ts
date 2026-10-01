import type { Message, Session } from '../contracts';
import { validateAnswers, type NativeQuestion } from './index';

export interface QuestionPresentation { state: 'open' | 'deferred' | 'dismissed' | 'answered'; context: string }
export interface AsyncQuestionReply { messageId: string; answers: Record<string, string[]> }
export interface AsyncQuestionReference { messageId: string; context: string; questions: string }

export function questionContext(session: Session): string {
  return JSON.stringify([session.status, session.nativeTurnId, session.binding.nativeSessionId, session.modelTargetId]);
}

export function asyncQuestionState(session: Session, message: Message): 'open' | 'deferred' | 'dismissed' | 'answered' {
  const index = session.messages.findIndex(item => item.id === message.id);
  if (index < 0 || message.role !== 'assistant' || !message.questions?.length) return 'answered';
  const saved = message.questionPresentation;
  if (saved?.state === 'dismissed' || saved?.state === 'deferred' || saved?.state === 'answered') return saved.state;
  if (saved?.state === 'open' && saved.context === questionContext(session)) return 'open';
  if (saved) return 'deferred';
  // Legacy questions followed by a user message were already retired by the old UI.
  if (session.messages.slice(index + 1).some(item => item.role === 'user')) return 'answered';
  return session.status === 'running' && !message.nativeTurnEnd && (!message.nativeTurnId || message.nativeTurnId === session.nativeTurnId) ? 'open' : 'deferred';
}

export function recordAsyncQuestions(session: Session, message: Message, questions: NativeQuestion[]): void {
  if (JSON.stringify(message.questions) !== JSON.stringify(questions)) message.questionPresentation = { state: 'open', context: questionContext(session) };
  message.questions = questions;
}

export function currentAsyncQuestion(session: Session, messageId: string, reference?: AsyncQuestionReference): Message {
  const message = session.messages.find(item => item.id === messageId);
  if (!message || asyncQuestionState(session, message) !== 'open' || reference && (reference.context !== questionContext(session) || reference.questions !== JSON.stringify(message.questions))) throw Error('ASYNC_QUESTION_STALE');
  return message;
}

export function prepareAsyncQuestion(session: Session, value: unknown) {
  if (!value || typeof value !== 'object' || typeof (value as AsyncQuestionReply).messageId !== 'string') throw Error('ASYNC_QUESTION_INVALID');
  const reply = value as AsyncQuestionReply, message = currentAsyncQuestion(session, reply.messageId);
  // Ordinary conversation messages cannot preserve a native secret-answer boundary.
  if (message.questions!.some(question => question.secret)) throw Error('ASYNC_SECRET_QUESTION_UNSUPPORTED');
  const answers = validateAnswers(message.questions!, reply.answers);
  const serialize = (values: Record<string, string[]>) => message.questions!.map(question => `${question.question}\n${values[question.id]!.join(', ')}`).join('\n\n');
  return { message, answers, serialize, original: serialize(answers), reference: { messageId: message.id, context: questionContext(session), questions: JSON.stringify(message.questions) } satisfies AsyncQuestionReference };
}
