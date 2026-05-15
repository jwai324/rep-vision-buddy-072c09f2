import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Sparkles, X, Send, Trash2 } from 'lucide-react';
import { useChatContext } from '@/contexts/ChatContext';
import { cn } from '@/lib/utils';
import ReactMarkdown from 'react-markdown';
import { ProposalDiffCard } from '@/components/chat/ProposalDiffCard';

const MAX_CHAT_CHARS = 500;

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
}

export const AIChatBubble: React.FC<AIChatBubbleProps> = ({ templates }) => {
  const {
    messages, isOpen, isLoading, setOpen, sendMessage,
    clearChat, quickChips,
    dailyUsage, consecutiveErrors, cooldownActive,
    proposals, proposalIdsByMessage, applyProposal, discardProposal,
  } = useChatContext();

  const templateNameById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const t of templates || []) map[t.id] = t.name;
    return map;
  }, [templates]);

  const [input, setInput] = useState('');
  const [hasSeenPulse, setHasSeenPulse] = useState(() =>
    localStorage.getItem('ai-chat-pulse-seen') === 'true'
  );
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [isOpen]);

  const isSendDisabled = !input.trim() || isLoading || dailyUsage.limitReached || cooldownActive || consecutiveErrors >= 2;

  const handleSend = () => {
    if (isSendDisabled) return;
    const text = input.trim().slice(0, MAX_CHAT_CHARS);
    setInput('');
    if (navigator.vibrate) navigator.vibrate(10);
    sendMessage(text);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (val.length <= MAX_CHAT_CHARS) {
      setInput(val);
    }
  };

  const handleFabClick = () => {
    if (!hasSeenPulse) {
      setHasSeenPulse(true);
      localStorage.setItem('ai-chat-pulse-seen', 'true');
    }
    setOpen(!isOpen);
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
        <div className="fixed inset-x-0 bottom-0 z-50 flex flex-col bg-background border-t border-border rounded-t-2xl shadow-2xl animate-in slide-in-from-bottom duration-300"
          style={{ height: '75vh', maxHeight: '75vh' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full gradient-green flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-primary-foreground" />
              </div>
              <div>
                <h3 className="font-bold text-foreground text-sm">AI Coach</h3>
                <p className="text-[10px] text-muted-foreground">
                  {dailyUsage.count}/{dailyUsage.limit} messages today
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={clearChat} className="p-2 text-muted-foreground hover:text-foreground transition-colors rounded-lg hover:bg-secondary">
                <Trash2 className="w-4 h-4" />
              </button>
              <button onClick={() => setOpen(false)} className="p-2 text-muted-foreground hover:text-foreground transition-colors rounded-lg hover:bg-secondary">
                <X className="w-5 h-5" />
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
          {messages.length <= 2 && !dailyUsage.limitReached && (
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
          {dailyUsage.limitReached && (
            <div className="px-4 pb-2 flex-shrink-0">
              <p className="text-xs text-center text-destructive font-medium">
                You've hit your daily AI limit. Resets at midnight.
              </p>
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
            <div className="flex items-center gap-2">
              <div className="flex-1 relative">
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={handleInputChange}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                  placeholder={dailyUsage.limitReached ? "Daily limit reached" : "Ask anything..."}
                  className="w-full bg-card border border-border rounded-xl px-3.5 py-2.5 pr-16 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  disabled={isLoading || dailyUsage.limitReached || consecutiveErrors >= 2}
                  maxLength={MAX_CHAT_CHARS}
                />
                {input.length > 0 && (
                  <span className={cn(
                    "absolute right-3 top-1/2 -translate-y-1/2 text-[10px]",
                    charsRemaining <= 50 ? "text-destructive" : "text-muted-foreground"
                  )}>
                    {input.length}/{MAX_CHAT_CHARS}
                  </span>
                )}
              </div>
              <button
                onClick={handleSend}
                disabled={isSendDisabled}
                className={cn(
                  "w-10 h-10 rounded-xl flex items-center justify-center transition-all",
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
