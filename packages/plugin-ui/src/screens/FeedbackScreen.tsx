import { useState, type FormEvent } from 'react';
import {
  RiCheckLine,
  RiLoader4Line,
  RiMailLine,
  RiUser6Line,
} from '@remixicon/react';
import * as Input from '../components/ui/input';
import * as Textarea from '../components/ui/textarea';
import * as FancyButton from '../components/ui/fancy-button';

export const FEEDBACK_MESSAGE_MAX = 200;

export type FeedbackState =
  | { step: 'idle' }
  | { step: 'sending' }
  | { step: 'done' }
  | { step: 'error'; message: string };

type FeedbackScreenProps = {
  state: FeedbackState;
  onSubmit: (data: { name: string; email: string; message: string }) => void;
  onClose: () => void;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function FeedbackScreen({ state, onSubmit, onClose }: FeedbackScreenProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const sending = state.step === 'sending';

  const valid =
    name.trim().length > 0 &&
    EMAIL_RE.test(email.trim()) &&
    message.trim().length > 0 &&
    message.length <= FEEDBACK_MESSAGE_MAX;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!valid || sending) return;
    onSubmit({ name: name.trim(), email: email.trim(), message: message.trim() });
  }

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]">
      <div className="relative flex w-[360px] max-h-full flex-col overflow-y-auto rounded-2xl bg-bg-white-0 px-5 py-5 shadow-xl">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-text-soft-400 transition hover:bg-bg-weak-50 hover:text-text-sub-600"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>

        {state.step === 'done' ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <span className="flex size-10 items-center justify-center rounded-full bg-success-lighter">
              <RiCheckLine className="size-5 text-success-base" aria-hidden />
            </span>
            <p className="m-0 text-label-md text-text-strong-950">Feedback sent</p>
            <p className="m-0 text-paragraph-sm text-text-sub-600">
              Thanks for helping us improve.
            </p>
            <FancyButton.Root
              type="button"
              variant="neutral"
              size="small"
              className="mt-3 w-full"
              onClick={onClose}
            >
              Close
            </FancyButton.Root>
          </div>
        ) : (
          <>
            <h2 className="m-0 text-label-lg text-text-strong-950">Send Feedback</h2>
            <p className="m-0 mt-1 text-paragraph-sm text-text-sub-600">
              Report issues, give feedback, and more.
            </p>

            <div className="my-4 border-t border-dashed border-stroke-soft-200" />

            <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="feedback-name" className="text-label-sm text-text-strong-950">
                  Full Name
                </label>
                <Input.Root size="medium">
                  <Input.Wrapper>
                    <Input.Icon as={RiUser6Line} />
                    <Input.Input
                      id="feedback-name"
                      type="text"
                      autoComplete="name"
                      placeholder="Enter your name..."
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      disabled={sending}
                      autoFocus
                    />
                  </Input.Wrapper>
                </Input.Root>
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="feedback-email" className="text-label-sm text-text-strong-950">
                  Email
                </label>
                <Input.Root size="medium">
                  <Input.Wrapper>
                    <Input.Icon as={RiMailLine} />
                    <Input.Input
                      id="feedback-email"
                      type="text"
                      inputMode="email"
                      autoComplete="email"
                      placeholder="Enter your email address..."
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={sending}
                    />
                  </Input.Wrapper>
                </Input.Root>
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="feedback-message" className="text-label-sm text-text-strong-950">
                  Message
                </label>
                <Textarea.Root>
                  <Textarea.Textarea
                    id="feedback-message"
                    rows={4}
                    placeholder="Enter your message..."
                    maxLength={FEEDBACK_MESSAGE_MAX}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    disabled={sending}
                  />
                  <Textarea.CharCounter current={message.length} max={FEEDBACK_MESSAGE_MAX} />
                </Textarea.Root>
              </div>

              {state.step === 'error' && (
                <p className="m-0 rounded-lg bg-error-lighter px-3 py-2 text-center text-paragraph-xs text-error-base">
                  {state.message}
                </p>
              )}

              <FancyButton.Root
                type="submit"
                variant="primary"
                size="medium"
                className="w-full"
                disabled={sending || !valid}
              >
                {sending ? (
                  <RiLoader4Line className="size-4 animate-spin" aria-hidden />
                ) : (
                  'Submit'
                )}
              </FancyButton.Root>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
