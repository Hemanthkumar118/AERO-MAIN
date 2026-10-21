import { useState, useRef, useEffect, Component, type ReactNode, type ErrorInfo } from 'react';
import ReactMarkdown from 'react-markdown';
import { aiService, type ChatMessage, type Conversation } from '../services/aiService';
import { useAuth } from '../../../providers/AuthProvider';

// Error Boundary for AIAssistant
class AIErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[AIAssistant Crash Caught]', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed bottom-6 right-6 z-[1000] p-4 bg-slate-900 border border-red-500/50 rounded-2xl text-red-400 shadow-2xl max-w-sm">
          <p className="font-bold text-sm mb-1">AERO Intelligence Notice</p>
          <p className="text-xs text-slate-300">{this.state.error?.message || 'Chat assistant encountered an unexpected error.'}</p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="mt-3 px-3 py-1 bg-red-950/60 hover:bg-red-900/60 border border-red-700/60 text-red-200 text-xs font-bold rounded"
          >
            Restart Assistant
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

interface AIAssistantProps {
  incidentContext?: string | null;
}

export function AIAssistantInner({ incidentContext }: AIAssistantProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [hasInitialized, setHasInitialized] = useState(false);

  const { session, user, authLoading } = useAuth();
  const isAuthenticated = Boolean(session || user || (typeof window !== 'undefined' && (
    localStorage.getItem('aero-auth-session') ||
    localStorage.getItem('aero-session-ambulance') ||
    localStorage.getItem('aero-session-police') ||
    localStorage.getItem('aero-session-hospital') ||
    localStorage.getItem('aero-session-admin') ||
    localStorage.getItem('aero-session-default')
  )));

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
      if (!hasInitialized && !authLoading && isAuthenticated) {
        initConversation();
      }
    }
  }, [messages, isOpen, isLoading, hasInitialized, authLoading, isAuthenticated]);

  const initConversation = async () => {
    setHasInitialized(true);
    try {
      const convs = await aiService.loadConversations();
      setConversations(convs);
      
      if (!activeConversationId && convs.length > 0) {
        const latest = convs[0];
        setActiveConversationId(latest.id);
        const msgs = await aiService.loadMessages(latest.id);
        setMessages(msgs);
      }
    } catch (err: any) {
      console.warn('[AIAssistant] Notice initializing conversation:', err.message);
    }
  };

  const loadConversations = async () => {
    try {
      const convs = await aiService.loadConversations();
      setConversations(convs);
    } catch (err) {
      console.warn('[AIAssistant] Error loading conversations', err);
    }
  };

  const loadConversation = async (id: string) => {
    try {
      setActiveConversationId(id);
      setShowHistory(false);
      setMessages([]);
      setIsLoading(true);
      setError('');
      const msgs = await aiService.loadMessages(id);
      setMessages(msgs);
    } catch (err: any) {
      console.error('[AIAssistant] Failed to load messages', err);
      setError('Failed to load conversation history.');
    } finally {
      setIsLoading(false);
    }
  };

  const createNewChat = () => {
    setActiveConversationId(null);
    setMessages([]);
    setShowHistory(false);
    setError('');
  };

  const deleteConversation = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!window.confirm('Delete this conversation history?')) return;
    
    try {
      await aiService.deleteConversation(id);
      if (activeConversationId === id) {
        setActiveConversationId(null);
        setMessages([]);
      }
      loadConversations();
    } catch (err) {
      console.error('[AIAssistant] Error deleting conversation:', err);
    }
  };

  const handleSend = async (text: string = input) => {
    if (!text.trim() || isLoading) return;

    const userText = text.trim();
    setInput('');
    setError('');

    const newUserMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: userText,
      created_at: new Date().toISOString(),
    };

    setMessages(prev => [...prev, newUserMsg]);
    setIsLoading(true);

    try {
      const response = await aiService.sendMessage(
        userText, 
        activeConversationId, 
        incidentContext
      );

      const newAssistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: response.reply,
        created_at: new Date().toISOString(),
      };

      setMessages(prev => [...prev, newAssistantMsg]);
      
      if (response.conversationId && response.conversationId !== activeConversationId) {
        setActiveConversationId(response.conversationId);
        loadConversations();
      }

    } catch (err: any) {
      setError(err.message || 'Message could not be processed. Operational tools remain active.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const quickActions = [
    { label: '🚑 Summarize current incident', prompt: 'Summarize my current incident' },
    { label: '🏥 Find nearest hospital', prompt: 'Find the nearest suitable hospital' },
    { label: '🚦 What traffic risks should I watch?', prompt: 'What traffic risks should I watch?' },
    { label: '⚠️ What should I do for this emergency?', prompt: 'What should I do for this emergency?' }
  ];

  return (
    <>
      {/* Floating Launcher Button */}
      <button
        onClick={() => setIsOpen(true)}
        aria-label="Open AERO Intelligence"
        className={`fixed bottom-20 right-4 sm:bottom-6 sm:right-6 z-[990] w-14 h-14 bg-[#0F172A] hover:bg-[#1E293B] border-2 border-cyan-500/60 text-cyan-400 rounded-full shadow-[0_0_24px_rgba(6,182,212,0.35)] flex items-center justify-center transition-all hover:scale-105 active:scale-95 cursor-pointer ${
          isOpen ? 'scale-0 opacity-0 pointer-events-none' : 'scale-100 opacity-100'
        }`}
      >
        <div className="absolute inset-0 rounded-full animate-ping bg-cyan-400/20" style={{ animationDuration: '3s' }}></div>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2a10 10 0 1 0 10 10H12V2z"></path>
          <path d="M12 8v4l3 3"></path>
        </svg>
      </button>

      {/* Main Responsive Chat Modal / Panel */}
      <div
        role="region"
        aria-label="AERO Intelligence Chat"
        className={`fixed z-[1000] transition-all duration-300 ${
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        } inset-0 sm:inset-auto sm:bottom-6 sm:right-6 w-full sm:w-[440px] max-w-full sm:max-w-[calc(100vw-32px)] h-[100dvh] sm:h-[680px] sm:max-h-[85vh] bg-[#07090C]/95 backdrop-blur-xl border-0 sm:border sm:border-cyan-500/40 sm:rounded-2xl shadow-[0_16px_50px_rgba(0,0,0,0.8)] flex flex-col overflow-hidden`}
        style={{ colorScheme: 'dark' }}
      >
        {/* Header */}
        <div className="bg-[#0D111A] px-4 py-3 border-b border-slate-800 flex items-center justify-between shrink-0 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <div className="flex items-center gap-2.5">
            <button 
              onClick={() => setShowHistory(!showHistory)}
              className="p-1.5 text-slate-400 hover:text-cyan-400 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
              title="Toggle Conversation History"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="3" y1="12" x2="21" y2="12"></line>
                <line x1="3" y1="6" x2="21" y2="6"></line>
                <line x1="3" y1="18" x2="21" y2="18"></line>
              </svg>
            </button>

            <div className="w-8 h-8 rounded-full bg-cyan-950/80 border border-cyan-500/50 flex items-center justify-center relative shadow-[0_0_12px_rgba(6,182,212,0.3)] shrink-0">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" strokeWidth="2.5">
                <path d="M12 2a10 10 0 1 0 10 10H12V2z"></path>
              </svg>
              <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-500 border-2 border-[#0D111A] rounded-full"></span>
            </div>

            <div className="min-w-0">
              <h3 className="font-bold text-white text-[13px] tracking-wide truncate">AERO INTELLIGENCE</h3>
              <p className="text-[10px] text-emerald-400 font-semibold tracking-wider flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span>
                ACTIVE COPILOT
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button 
              onClick={createNewChat} 
              className="p-2 text-slate-400 hover:text-cyan-400 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer" 
              title="New Chat"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
            </button>
            <button 
              onClick={() => setIsOpen(false)} 
              className="p-2 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer" 
              title="Close"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12"></path>
              </svg>
            </button>
          </div>
        </div>

        {/* Content Container */}
        <div className="flex-1 relative overflow-hidden flex flex-col min-h-0 bg-[#07090C]">
          
          {/* History Sidebar */}
          <div 
            className={`absolute inset-y-0 left-0 w-64 bg-[#0D111A]/98 border-r border-slate-800 z-20 transition-transform duration-300 overflow-y-auto ${
              showHistory ? 'translate-x-0 shadow-2xl' : '-translate-x-full'
            }`}
          >
            <div className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Chat History</h4>
                <button 
                  onClick={() => setShowHistory(false)} 
                  className="text-xs text-slate-500 hover:text-slate-300"
                >
                  Close
                </button>
              </div>

              {conversations.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-6">No saved conversations yet.</p>
              ) : (
                <div className="space-y-1">
                  {conversations.map(conv => (
                    <div 
                      key={conv.id}
                      onClick={() => loadConversation(conv.id)}
                      className={`group flex items-center justify-between p-2.5 rounded-xl cursor-pointer transition-colors ${
                        activeConversationId === conv.id ? 'bg-cyan-950/50 border border-cyan-800/60' : 'hover:bg-slate-800/60'
                      }`}
                    >
                      <div className="truncate flex-1 min-w-0 pr-2">
                        <p className={`text-xs truncate font-medium ${activeConversationId === conv.id ? 'text-cyan-300' : 'text-slate-200'}`}>
                          {conv.title}
                        </p>
                        <p className="text-[10px] text-slate-500 mt-0.5">{new Date(conv.created_at).toLocaleDateString()}</p>
                      </div>
                      <button 
                        onClick={(e) => deleteConversation(e, conv.id)}
                        className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-red-400 transition-opacity shrink-0"
                        title="Delete Conversation"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path>
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Messages Area */}
          <div 
            className="flex-1 overflow-y-auto p-4 space-y-4 overscroll-contain"
            onClick={() => showHistory && setShowHistory(false)}
          >
            {authLoading ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6">
                <div className="w-12 h-12 rounded-full border-2 border-cyan-500 border-t-transparent animate-spin mb-3"></div>
                <p className="text-xs text-slate-400 font-medium">Connecting to AERO Intelligence...</p>
              </div>
            ) : !isAuthenticated ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6">
                <div className="w-12 h-12 rounded-2xl bg-red-950/40 border border-red-500/40 flex items-center justify-center mb-3 text-red-400">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                  </svg>
                </div>
                <h3 className="text-sm font-bold text-white mb-1">Operator Session Required</h3>
                <p className="text-xs text-slate-400 max-w-xs">Please sign in as an ambulance, police, hospital, or admin operator to access AERO Intelligence.</p>
              </div>
            ) : (
              <>
                {messages.length === 0 && !isLoading && (
                  <div className="h-full flex flex-col items-center justify-center text-center p-4">
                    <div className="w-14 h-14 rounded-2xl bg-cyan-950/40 border border-cyan-500/30 flex items-center justify-center mb-3 shadow-[0_0_20px_rgba(6,182,212,0.2)]">
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" strokeWidth="1.75">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                      </svg>
                    </div>
                    <h3 className="text-base font-bold text-white mb-1">AERO Copilot Active</h3>
                    <p className="text-xs text-slate-400 max-w-[280px] mb-6">Real-time emergency intelligence, incident synthesis, hospital capability lookups, and protocol guidance.</p>
                    
                    <div className="flex flex-col gap-2 w-full max-w-[320px]">
                      {quickActions.map(action => (
                        <button
                          key={action.prompt}
                          onClick={() => handleSend(action.prompt)}
                          className="bg-[#0D111A] hover:bg-cyan-950/40 border border-slate-800 hover:border-cyan-500/50 text-cyan-300 text-xs px-3.5 py-2.5 rounded-xl transition-all font-medium text-left flex items-center justify-between group cursor-pointer"
                        >
                          <span className="truncate">{action.label}</span>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-2">
                            <path d="M5 12h14M12 5l7 7-7 7"></path>
                          </svg>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {messages.map((msg, idx) => (
                  <div key={msg.id || idx} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                    {msg.role === 'assistant' && (
                      <div className="flex items-center gap-1.5 mb-1 ml-1">
                        <div className="w-4 h-4 rounded bg-cyan-950 border border-cyan-500/50 flex items-center justify-center">
                          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" strokeWidth="2.5">
                            <path d="M12 2a10 10 0 1 0 10 10H12V2z"></path>
                          </svg>
                        </div>
                        <span className="text-[10px] font-bold text-cyan-400 uppercase tracking-wider">AERO SYSTEM</span>
                      </div>
                    )}
                    <div
                      className={`max-w-[90%] sm:max-w-[85%] rounded-2xl px-4 py-3 text-[13px] leading-relaxed shadow-sm break-words ${
                        msg.role === 'user'
                          ? 'bg-cyan-600 text-white rounded-tr-sm'
                          : 'bg-[#0D111A] border border-slate-800 text-slate-100 rounded-tl-sm'
                      }`}
                    >
                      {msg.role === 'assistant' ? (
                        <div className="prose prose-invert prose-sm max-w-none prose-p:leading-relaxed prose-headings:text-white prose-li:my-0.5">
                          <ReactMarkdown>{msg.content}</ReactMarkdown>
                        </div>
                      ) : (
                        <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
                      )}
                    </div>
                  </div>
                ))}

                {isLoading && (
                  <div className="flex flex-col items-start">
                    <div className="flex items-center gap-1.5 mb-1 ml-1">
                      <div className="w-4 h-4 rounded bg-cyan-950 border border-cyan-500/50 flex items-center justify-center">
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" strokeWidth="2.5">
                          <path d="M12 2a10 10 0 1 0 10 10H12V2z"></path>
                        </svg>
                      </div>
                      <span className="text-[10px] font-bold text-cyan-400 uppercase tracking-wider">AERO SYSTEM</span>
                    </div>
                    <div className="bg-[#0D111A] border border-slate-800 rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-2 text-xs text-slate-400">
                      <span>Synthesizing operational response...</span>
                      <span className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-bounce"></span>
                      <span className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></span>
                      <span className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></span>
                    </div>
                  </div>
                )}

                {error && (
                  <div className="bg-red-950/40 border border-red-500/40 p-3.5 rounded-xl text-center">
                    <p className="text-red-300 text-xs font-medium mb-2">{error}</p>
                    <button 
                      onClick={() => setError('')} 
                      className="bg-red-900/40 px-3 py-1 rounded-lg text-red-200 font-bold text-xs hover:bg-red-900/60 transition-colors cursor-pointer"
                    >
                      Dismiss
                    </button>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </>
            )}
          </div>
        </div>

        {/* Input Composer */}
        <div className="p-3 bg-[#0D111A] border-t border-slate-800 shrink-0 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="relative flex items-end bg-[#07090C] border border-slate-800 rounded-xl focus-within:border-cyan-500 focus-within:ring-1 focus-within:ring-cyan-500/40 transition-all">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={authLoading ? "Authenticating..." : !isAuthenticated ? "Sign in to send messages" : "Type your query or choose an operational action..."}
              className="w-full bg-transparent px-3.5 py-3 text-[13px] text-white placeholder-slate-500 focus:outline-none resize-none max-h-[120px] scrollbar-thin disabled:opacity-50"
              rows={input.split('\n').length > 1 ? Math.min(input.split('\n').length, 3) : 1}
              disabled={isLoading || authLoading || !isAuthenticated}
            />
            <button
              onClick={() => handleSend()}
              disabled={!input.trim() || isLoading || authLoading || !isAuthenticated}
              aria-label="Send Message"
              className="p-3 text-cyan-400 hover:text-cyan-300 disabled:opacity-30 transition-colors shrink-0 cursor-pointer disabled:cursor-not-allowed"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={isLoading ? "animate-pulse" : ""}>
                <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"></path>
              </svg>
            </button>
          </div>
          <div className="flex justify-between items-center mt-1.5 px-1">
            <span className="text-[10px] text-slate-500">Press ENTER to send, SHIFT+ENTER for new line</span>
          </div>
        </div>
      </div>
    </>
  );
}

export function AIAssistant(props: AIAssistantProps) {
  return (
    <AIErrorBoundary>
      <AIAssistantInner {...props} />
    </AIErrorBoundary>
  );
}
