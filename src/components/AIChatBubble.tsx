import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Sparkles, Send, Trash2, Mic, MicOff } from 'lucide-react';
import { toast } from 'sonner';
import { useChatContext, GOD_MODE_PHRASE } from '@/contexts/ChatContext';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import { cn } from '@/lib/utils';
import ReactMarkdown from 'react-markdown';
import { ProposalDiffCard } from '@/components/chat/ProposalDiffCard';

const MAX_CHAT_CHARS = 500;
// Cap the auto-growing input at 3 visible lines; anything longer scrolls
// internally. Chosen so drafting/editing a fuller message is comfortable
// without letting the input consume too much of the chat panel.
const MAX_INPUT_ROWS = 3;
const DRAFT_STORAGE_KEY = 'ai-chat-input-draft';

const TypingIndicator = () => (
  <div className="flex items-center gap-1 px-3 py-2">
    {[0, 1, 2].map(i => (
      <div
        key={i}
        className="w-2 h-2 rounded-full bg-muted-foreground/50 animate-bounce"
        style={{ animationDelay: `${i * 150}ms` }}
      />
    ))}
  </div>
);

interface AIChatBubbleProps {
  templates?: { id: string; name: string }[];
  onOpenCredits?: () => void;
}

export const AIChatBubble: React.FC<AIChatBubbleProps> = ({ templates, onOpenCredits }) => {
  const {
    messages, isOpen, isLoading, setOpen, sendMessage,
    clearChat, quickChips,
    creditsBalance, godMode, consecutiveErrors, cooldownActive,
    proposals, proposalIdsByMessage, applyProposal, discardProposal,
  } = useChatContext();

  const templateNameById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const t of templates || []) map[t.id] = t.name;
    return map;
  }, [templates]);

  const [input, setInput] = useState(() => {
    try {
      return localStorage.getItem(DRAFT_STORAGE_KEY) ?? '';
    } catch {
      return '';
    }
  });

  useEffect(() => {
    try {
      if (input) {
        localStorage.setItem(DRAFT_STORAGE_KEY, input);
      } else {
        localStorage.removeItem(DRAFT_STORAGE_KEY);
      }
    } catch {
      // storage unavailable (private mode, quota) — draft just won't persist
    }
  }, [input]);

  const [hasSeenPulse, setHasSeenPulse] = useState(() =>
    localStorage.getItem('ai-chat-pulse-seen') === 'true'
  );
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartY = useRef<number | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  useEffect(() => {
    if (!isOpen) {
      setDragOffset(0);
      setIsDragging(false);
      dragStartY.current = null;
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [isOpen]);

  const isGodPhrase = input.trim().toLowerCase() === GOD_MODE_PHRASE;
  const limitBlocks = creditsBalance.exhausted && !godMode && !isGodPhrase;
  const isSendDisabled = !input.trim() || isLoading || limitBlocks || cooldownActive || consecutiveErrors >= 2;

  const handleSpeechFinal = useCallback((chunk: string) => {
    setInput(prev => {
      const joined = prev ? `${prev.trimEnd()} ${chunk}` : chunk;
      return joined.slice(0, MAX_CHAT_CHARS);
    });
  }, []);
  const handleSpeechError = useCallback((err: string) => {
    if (err === 'not-allowed' || err === 'service-not-allowed') {
      toast.error('Microphone access denied. Enable it in your browser settings.');
    } else if (err === 'audio-capture') {
      toast.error("Couldn't reach a microphone.");
    } else if (err === 'restart-loop') {
      toast.error('Voice input kept dropping out, so it was turned off.');
    } else {
      toast.error(`Voice input failed: ${err}`);
    }
  }, []);
  const speech = useSpeechRecognition({
    onFinalResult: handleSpeechFinal,
    onError: handleSpeechError,
  });

  // Dictation now runs until the user taps the mic again, so closing the panel
  // has to end it too — otherwise the microphone stays live behind a dismissed
  // chat with nothing on screen indicating it.
  const stopSpeech = speech.stop;
  const isListening = speech.isListening;
  useEffect(() => {
    if (!isOpen && isListening) stopSpeech();
  }, [isOpen, isListening, stopSpeech]);

  const handleMicToggle = () => {
    if (isLoading || limitBlocks || consecutiveErrors >= 2) return;
    if (navigator.vibrate) navigator.vibrate(5);
    speech.toggle();
  };

  const handleSend = () => {
    if (isSendDisabled) return;
    // Sending deliberately leaves dictation running: the mic button is the
    // only thing that turns it off, so you can dictate a follow-up without
    // reaching for it again.
    const text = input.trim().slice(0, MAX_CHAT_CHARS);
    setInput('');
    if (navigator.vibrate) navigator.vibrate(10);
    sendMessage(text);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    if (val.length <= MAX_CHAT_CHARS) {
      setInput(val);
    }
  };

  // Auto-resize the message textarea from 1 row up to MAX_INPUT_ROWS,
  // scrolling internally beyond that. Runs whenever the value changes (typing,
  // paste, dictation) and when the panel first opens so the initial single-row
  // height is applied deterministically. Falls back to a scrollHeight-only
  // formula if the computed line-height parses as NaN (some test envs).
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const style = window.getComputedStyle(el);
    const lineHeight = parseFloat(style.lineHeight);
    const paddingTop = parseFloat(style.paddingTop) || 0;
    const paddingBottom = parseFloat(style.paddingBottom) || 0;
    const cap = Number.isFinite(lineHeight)
      ? lineHeight * MAX_INPUT_ROWS + paddingTop + paddingBottom
      : el.scrollHeight;
    const next = Math.min(el.scrollHeight, cap);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > cap ? 'auto' : 'hidden';
  }, [input, isOpen]);

  const handleFabClick = () => {
    if (!hasSeenPulse) {
      setHasSeenPulse(true);
      localStorage.setItem('ai-chat-pulse-seen', 'true');
    }
    setOpen(!isOpen);
  };

  const COLLAPSE_THRESHOLD = 120;

  const handleDragStart = (e: React.TouchEvent) => {
    dragStartY.current = e.touches[0].clientY;
    setIsDragging(true);
  };

  const handleDragMove = (e: React.TouchEvent) => {
    if (dragStartY.current === null) return;
    const delta = e.touches[0].clientY - dragStartY.current;
    setDragOffset(Math.max(0, delta));
  };

  const handleDragEnd = () => {
    if (dragOffset > COLLAPSE_THRESHOLD) {
      setOpen(false);
    }
    setDragOffset(0);
    setIsDragging(false);
    dragStartY.current = null;
  };

  const charsRemaining = MAX_CHAT_CHARS - input.length;

  return (
    <>
      {/* FAB */}
      {!isOpen && (
        <button
          onClick={handleFabClick}
          className={cn(
            "fixed bottom-6 right-4 z-50 w-14 h-14 rounded-full gradient-green",
            "flex items-center justify-center shadow-lg",
            "transition-transform active:scale-90",
            !hasSeenPulse && "animate-pulse"
          )}
          style={{ boxShadow: '0 0 20px hsl(120 100% 55% / 0.4)' }}
        >
          <Sparkles className="w-6 h-6 text-primary-foreground" />
        </button>
      )}

      {/* Chat Panel */}
      {isOpen && (
        <div
          className="fixed inset-x-0 bottom-0 z-50 flex flex-col bg-background border-t border-border rounded-t-2xl shadow-2xl animate-in slide-in-from-bottom duration-300"
          style={{
            // dvh (dynamic viewport height) shrinks as mobile browser chrome
            // (URL bar / on-screen keyboard) expands, so the chat input stays
            // above the keyboard instead of getting shoved off-screen. vh
            // treats the viewport as the largest possible size and doesn't
            // react to the keyboard at all.
            height: '75dvh',
            maxHeight: '75dvh',
            transform: dragOffset ? `translateY(${dragOffset}px)` : undefined,
            transition: isDragging ? 'none' : 'transform 0.2s ease-out',
          }}
        >
          {/* Drag handle + Header — swipe down to collapse */}
          <div
            onTouchStart={handleDragStart}
            onTouchMove={handleDragMove}
            onTouchEnd={handleDragEnd}
            className="flex-shrink-0 touch-none"
          >
            <div className="flex justify-center pt-2 pb-1">
              <div className="w-10 h-1.5 rounded-full bg-muted-foreground/30" />
            </div>
            <div className="flex items-center justify-between px-4 pb-3 pt-1 border-b border-border">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full gradient-green flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-primary-foreground" />
                </div>
                <div>
                  <h3 className="font-bold text-foreground text-sm">AI Coach</h3>
                  {godMode ? (
                    <p className="text-[10px] text-muted-foreground">God mode — unlimited</p>
                  ) : (
                    <p className="text-[11px] text-muted-foreground leading-tight">
                      <span className="font-bold text-foreground">{creditsBalance.credits.toLocaleString()}</span>
                      {' '}credits
                      <span className="text-muted-foreground/70"> · ~{creditsBalance.estMessagesLeft} msgs left</span>
                    </p>
                  )}
                </div>
              </div>
              <button onClick={clearChat} className="p-2 text-muted-foreground hover:text-foreground transition-colors rounded-lg hover:bg-secondary">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {messages.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <Sparkles className="w-10 h-10 mx-auto mb-3 text-primary/40" />
                <p className="text-sm font-medium">Hey! I'm your AI coach.</p>
                <p className="text-xs mt-1">I can create templates, build programs, analyze your training, and more.</p>
              </div>
            )}

            {messages.map(msg => (
              <div key={msg.id} className={cn("flex", msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                <div className={cn(
                  "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm",
                  msg.role === 'user'
                    ? "bg-primary text-primary-foreground rounded-br-md"
                    : "bg-card border border-border text-foreground rounded-bl-md"
                )}>
                  {msg.role === 'assistant' && msg.isLoading && !msg.content ? (
                    <TypingIndicator />
                  ) : msg.role === 'assistant' ? (
                    <div className="prose prose-sm prose-invert max-w-none [&>p]:m-0 [&>ul]:m-0 [&>ol]:m-0">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  )}

                  {(proposalIdsByMessage[msg.id] || []).map(pid => {
                    const proposal = proposals[pid];
                    if (!proposal) return null;
                    return (
                      <ProposalDiffCard
                        key={pid}
                        proposal={proposal}
                        templateNameById={templateNameById}
                        onApply={applyProposal}
                        onDiscard={discardProposal}
                      />
                    );
                  })}

                  {msg.toolCalls && msg.toolCalls.length > 0 && !(proposalIdsByMessage[msg.id]?.length) && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {msg.toolCalls.map(tc => (
                        <span key={tc.id} className="text-[10px] px-2 py-0.5 rounded-full bg-primary/15 text-primary font-medium">
                          ✓ {tc.name.replace(/_/g, ' ')}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {isLoading && !messages.some(m => m.isLoading) && (
              <div className="flex justify-start">
                <div className="bg-card border border-border rounded-2xl rounded-bl-md">
                  <TypingIndicator />
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Quick chips */}
          {messages.length <= 2 && (!creditsBalance.exhausted || godMode) && (
            <div className="px-4 pb-2 flex-shrink-0">
              <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
                {quickChips.map(chip => (
                  <button
                    key={chip}
                    onClick={() => { if (!isLoading && !cooldownActive) sendMessage(chip); }}
                    className="whitespace-nowrap text-xs px-3 py-1.5 rounded-full border border-border bg-card text-foreground hover:border-primary hover:text-primary transition-colors flex-shrink-0"
                  >
                    {chip}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Status messages */}
          {creditsBalance.exhausted && !godMode && (
            <div className="px-4 pb-2 flex-shrink-0 flex flex-col items-center gap-2">
              <p className="text-xs text-center text-destructive font-medium">
                You've used your AI allowance for this month. Top up or check your plan to keep chatting.
              </p>
              {onOpenCredits && (
                <button
                  onClick={() => { setOpen(false); onOpenCredits(); }}
                  className="text-xs font-semibold px-4 py-2 rounded-full gradient-green text-primary-foreground"
                >
                  Top up or manage plan
                </button>
              )}
            </div>
          )}
          {creditsBalance.lowBalance && !creditsBalance.exhausted && !godMode && (
            <div className="px-4 pb-2 flex-shrink-0 flex items-center justify-center gap-2">
              <p className="text-xs text-center text-muted-foreground">
                Running low — ~{creditsBalance.estMessagesLeft} msgs left.
              </p>
              {onOpenCredits && (
                <button
                  onClick={() => { setOpen(false); onOpenCredits(); }}
                  className="text-xs font-semibold text-primary hover:underline"
                >
                  Get more
                </button>
              )}
            </div>
          )}
          {consecutiveErrors >= 2 && (
            <div className="px-4 pb-2 flex-shrink-0">
              <p className="text-xs text-center text-destructive/80 font-medium">
                AI is temporarily unavailable. You can still build templates manually.
              </p>
            </div>
          )}

          {/* Input */}
          <div className="px-4 pb-4 pt-2 border-t border-border flex-shrink-0">
            {speech.isListening && (
              <div className="flex items-center gap-2 mb-1.5 text-[11px] text-primary">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                </span>
                <span className="flex-1 truncate">
                  {speech.interimTranscript || 'Listening…'}
                </span>
              </div>
            )}
            <div className="flex items-end gap-2">
              <div className="flex-1 relative">
                <textarea
                  ref={inputRef}
                  rows={1}
                  value={input}
                  onChange={handleInputChange}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                  placeholder={
                    creditsBalance.exhausted && !godMode
                      ? "Out of credits"
                      : speech.isListening
                        ? "Listening…"
                        : "Ask anything…"
                  }
                  className="block w-full resize-none bg-card border border-border rounded-xl px-3.5 py-2.5 pr-16 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  disabled={isLoading || consecutiveErrors >= 2}
                  maxLength={MAX_CHAT_CHARS}
                />
                {input.length > 0 && (
                  <span className={cn(
                    // Anchored to the bottom-right so the counter stays put as
                    // the textarea grows from 1 to MAX_INPUT_ROWS. pointer-
                    // events-none keeps it from stealing clicks near the edge.
                    "pointer-events-none absolute right-3 bottom-2 text-[10px]",
                    charsRemaining <= 50 ? "text-destructive" : "text-muted-foreground"
                  )}>
                    {input.length}/{MAX_CHAT_CHARS}
                  </span>
                )}
              </div>
              {speech.isSupported && (
                <button
                  onClick={handleMicToggle}
                  disabled={isLoading || limitBlocks || consecutiveErrors >= 2}
                  aria-label={speech.isListening ? 'Stop dictation' : 'Start dictation'}
                  aria-pressed={speech.isListening}
                  className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center transition-all shrink-0",
                    speech.isListening
                      ? "bg-primary text-primary-foreground shadow-lg shadow-primary/40 animate-pulse"
                      : (isLoading || limitBlocks || consecutiveErrors >= 2)
                        ? "bg-secondary text-muted-foreground"
                        : "bg-secondary text-foreground hover:bg-secondary/70 hover:text-primary"
                  )}
                >
                  {speech.isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </button>
              )}
              <button
                onClick={handleSend}
                disabled={isSendDisabled}
                aria-label="Send message"
                className={cn(
                  "w-10 h-10 rounded-xl flex items-center justify-center transition-all shrink-0",
                  !isSendDisabled
                    ? "gradient-green text-primary-foreground"
                    : "bg-secondary text-muted-foreground"
                )}
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
