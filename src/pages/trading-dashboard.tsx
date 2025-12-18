import { useState, useEffect, useCallback } from 'react';
import { 
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area 
} from 'recharts';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { 
  Zap, Wallet, Settings, Cloud, List, Bot, TrendingUp, TrendingDown, 
  Activity, Play, Square, LogOut, ChevronRight, RefreshCw, Shield
} from 'lucide-react';
import type { 
  AppSettings, MarketData, Position, PositionSide, TradingLog, TradeAction, 
  AIProvider, MexcBalance, MexcOrder, MexcTrade 
} from '@shared/schema';

const STORAGE_KEY = 'aegis_ai_settings_v10';

const defaultSettings: AppSettings = {
  aiProvider: 'gemini',
  geminiApiKey: '',
  openaiApiKey: '',
  deepseekApiKey: '',
  mexcApiKey: '',
  mexcSecretKey: '',
  tradingSymbol: 'BTCUSDT',
  defaultLeverage: 10,
  riskPercent: 2,
  isAutoTrading: false,
  intervalMinutes: 1,
  isLiveMode: false,
  supabaseUrl: '',
  supabaseAnonKey: ''
};

type ViewType = 'DASHBOARD' | 'PORTFOLIO' | 'SETTINGS' | 'CLOUD' | 'LOGS';
type AccountSubView = 'BALANCES' | 'POSITIONS' | 'ORDERS' | 'HISTORY';

export default function TradingDashboard() {
  const { toast } = useToast();
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [loginError, setLoginError] = useState('');

  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error("Failed to load local settings", e);
    }
    return defaultSettings;
  });

  const [marketData, setMarketData] = useState<MarketData | null>(null);
  const [spotBalances, setSpotBalances] = useState<MexcBalance[]>([]);
  const [futuresBalances, setFuturesBalances] = useState<MexcBalance[]>([]);
  const [mexcPositions, setMexcPositions] = useState<Position[]>([]);
  const [mexcOrders, setMexcOrders] = useState<MexcOrder[]>([]);
  const [mexcTrades, setMexcTrades] = useState<MexcTrade[]>([]);
  
  const [logs, setLogs] = useState<TradingLog[]>([]);
  const [lastAction, setLastAction] = useState<TradeAction | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [view, setView] = useState<ViewType>('DASHBOARD');
  const [accountSubView, setAccountSubView] = useState<AccountSubView>('BALANCES');
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  const [mexcStatus, setMexcStatus] = useState<'CONNECTED' | 'DISCONNECTED' | 'ERROR'>('DISCONNECTED');
  const [supabaseStatus, setSupabaseStatus] = useState<'CONNECTED' | 'DISCONNECTED' | 'ERROR'>('DISCONNECTED');

  const addLog = useCallback((type: TradingLog['type'], message: string) => {
    const newLog: TradingLog = {
      id: Date.now().toString(),
      timestamp: new Date().toLocaleTimeString(),
      type,
      message
    };
    setLogs(prev => [newLog, ...prev].slice(0, 100));
  }, []);

  const handleSave = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    setSaveStatus('Saved');
    addLog('SUCCESS', 'Configuration saved locally.');
    setTimeout(() => setSaveStatus(null), 3000);
  }, [settings, addLog]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (loginForm.username === 'admin' && loginForm.password === '666666') {
      setIsLoggedIn(true);
      setLoginError('');
      addLog('SUCCESS', 'Login successful');
    } else {
      setLoginError('Invalid credentials.');
    }
  };

  const refreshMarket = useCallback(async () => {
    try {
      const response = await fetch(`/api/market/ticker?symbol=${settings.tradingSymbol}`);
      if (!response.ok) throw new Error('Market API error');
      const ticker = await response.json();
      const currentTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      setMarketData(prev => {
        const history = prev?.history ? [...prev.history] : [];
        const newHistory = [...history, { time: currentTime, price: ticker.price }].slice(-50);
        return { ...ticker, history: newHistory };
      });
      if (isLoading) setIsLoading(false);
    } catch (err) {
      if (isLoading) setIsLoading(false);
    }
  }, [settings.tradingSymbol, isLoading]);

  const refreshAccountData = useCallback(async () => {
    if (!settings.mexcApiKey || !settings.mexcSecretKey || !isLoggedIn) {
      setMexcStatus('DISCONNECTED');
      return;
    }
    try {
      const response = await apiRequest('POST', '/api/mexc/account', {
        apiKey: settings.mexcApiKey,
        secretKey: settings.mexcSecretKey,
        symbol: settings.tradingSymbol
      });
      
      const data = await response.json();
      
      if (data.error) {
        throw new Error(data.error);
      }
      
      setSpotBalances(data.spotBalances || []);
      setFuturesBalances(data.futuresBalances || []);
      setMexcPositions(data.positions || []);
      setMexcOrders(data.orders || []);
      setMexcTrades(data.trades || []);
      setMexcStatus('CONNECTED');
      addLog('SUCCESS', 'MEXC account synced successfully');
    } catch (e: any) {
      addLog('ERROR', `MEXC sync error: ${e.message}`);
      setMexcStatus('ERROR');
    }
  }, [settings, isLoggedIn, addLog]);

  const runTradingCycle = useCallback(async () => {
    if (!settings.isAutoTrading || !marketData) return;
    try {
      setIsAnalyzing(true);
      
      const response = await apiRequest('POST', '/api/ai/analyze', {
        settings: {
          aiProvider: settings.aiProvider,
          geminiApiKey: settings.geminiApiKey,
          openaiApiKey: settings.openaiApiKey,
          deepseekApiKey: settings.deepseekApiKey,
          tradingSymbol: settings.tradingSymbol,
          defaultLeverage: settings.defaultLeverage
        },
        marketData,
        currentPositionSide: mexcPositions.length > 0 ? mexcPositions[0].side : 'NONE'
      });
      
      const decision = await response.json();
      setLastAction(decision);
      
      if (decision.action !== 'WAIT') {
        addLog('TRADE', `AI decision: ${decision.action} (${decision.confidence}%)`);
        
        if (settings.isLiveMode) {
          await apiRequest('POST', '/api/mexc/trade', {
            action: decision.action,
            apiKey: settings.mexcApiKey,
            secretKey: settings.mexcSecretKey,
            symbol: settings.tradingSymbol,
            leverage: settings.defaultLeverage,
            price: marketData.price
          });
          refreshAccountData();
        }
      }
      setIsAnalyzing(false);
    } catch (err) {
      addLog('ERROR', `AI analysis failed: ${err instanceof Error ? err.message : 'Unknown'}`);
      setIsAnalyzing(false);
    }
  }, [settings, mexcPositions, marketData, addLog, refreshAccountData]);

  useEffect(() => {
    refreshMarket();
    const interval = setInterval(refreshMarket, 5000);
    return () => clearInterval(interval);
  }, [refreshMarket]);

  useEffect(() => {
    if (isLoggedIn && settings.mexcApiKey && settings.mexcSecretKey) {
      refreshAccountData();
      const interval = setInterval(refreshAccountData, 30000);
      return () => clearInterval(interval);
    }
  }, [refreshAccountData, isLoggedIn, settings.mexcApiKey, settings.mexcSecretKey]);

  useEffect(() => {
    let interval: number;
    if (settings.isAutoTrading) {
      runTradingCycle();
      interval = window.setInterval(runTradingCycle, settings.intervalMinutes * 60000);
    }
    return () => clearInterval(interval);
  }, [settings.isAutoTrading, settings.intervalMinutes, runTradingCycle]);

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4" data-testid="login-page">
        <Card className="p-8 w-full max-w-md">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-primary rounded-xl flex items-center justify-center mx-auto mb-4">
              <Shield className="w-8 h-8 text-primary-foreground" />
            </div>
            <h1 className="text-2xl font-bold" data-testid="text-login-title">Aegis AI Login</h1>
            <p className="text-muted-foreground text-sm mt-1">Enter credentials to access the terminal</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-muted-foreground uppercase mb-2">Username</label>
              <Input 
                type="text" 
                className="font-mono"
                value={loginForm.username}
                onChange={e => setLoginForm(p => ({ ...p, username: e.target.value }))}
                data-testid="input-username"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted-foreground uppercase mb-2">Password</label>
              <Input 
                type="password" 
                className="font-mono"
                value={loginForm.password}
                onChange={e => setLoginForm(p => ({ ...p, password: e.target.value }))}
                data-testid="input-password"
              />
            </div>
            {loginError && <p className="text-destructive text-xs text-center" data-testid="text-login-error">{loginError}</p>}
            <Button type="submit" className="w-full" data-testid="button-login">Sign In</Button>
          </form>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="h-screen bg-background flex flex-col items-center justify-center" data-testid="loading-screen">
        <div className="w-12 h-12 border-4 border-primary/30 border-t-primary rounded-full animate-spin mb-4"></div>
        <p className="text-sm font-medium text-muted-foreground">Loading Dashboard...</p>
      </div>
    );
  }

  const navItems = [
    { id: 'DASHBOARD' as ViewType, icon: Activity, label: 'Overview' },
    { id: 'PORTFOLIO' as ViewType, icon: Wallet, label: 'Portfolio' },
    { id: 'SETTINGS' as ViewType, icon: Settings, label: 'Bot Config' },
    { id: 'CLOUD' as ViewType, icon: Cloud, label: 'Sync Status' },
    { id: 'LOGS' as ViewType, icon: List, label: 'Activity Logs' }
  ];

  return (
    <div className="flex h-screen bg-background text-foreground" data-testid="trading-dashboard">
      <aside className="w-64 bg-sidebar border-r border-sidebar-border flex flex-col shrink-0">
        <div className="p-6 flex items-center gap-3">
          <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
            <Zap className="w-4 h-4 text-primary-foreground" />
          </div>
          <span className="text-lg font-bold tracking-tight">
            AEGIS <span className="text-primary">TRADER</span>
          </span>
        </div>

        <nav className="flex-1 px-4 space-y-1 overflow-y-auto">
          {navItems.map(item => (
            <Button 
              key={item.id}
              variant="ghost"
              onClick={() => setView(item.id)}
              className={`w-full justify-start gap-3 ${view === item.id ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-muted-foreground'}`}
              data-testid={`button-nav-${item.id.toLowerCase()}`}
            >
              <item.icon className="w-4 h-4" />
              <span>{item.label}</span>
            </Button>
          ))}
        </nav>

        <div className="p-4 border-t border-sidebar-border space-y-4">
          <Card className={`p-4 ${settings.isAutoTrading ? 'border-green-500/20 bg-green-500/5' : ''}`}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold text-muted-foreground uppercase">Auto Mode</span>
              <div className={`w-2 h-2 rounded-full ${settings.isAutoTrading ? 'bg-green-500 animate-pulse' : 'bg-destructive'}`}></div>
            </div>
            <Button 
              onClick={() => {
                const updated = { ...settings, isAutoTrading: !settings.isAutoTrading };
                setSettings(updated);
                localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
              }}
              variant={settings.isAutoTrading ? 'destructive' : 'default'}
              className="w-full"
              size="sm"
              data-testid="button-toggle-autotrading"
            >
              {settings.isAutoTrading ? <><Square className="w-3 h-3 mr-2" /> Stop Bot</> : <><Play className="w-3 h-3 mr-2" /> Start Bot</>}
            </Button>
          </Card>
          <Button 
            variant="ghost" 
            onClick={() => setIsLoggedIn(false)} 
            className="w-full text-muted-foreground"
            size="sm"
            data-testid="button-logout"
          >
            <LogOut className="w-4 h-4 mr-2" /> Sign Out
          </Button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 bg-background">
        <header className="h-16 border-b border-border flex items-center justify-between px-8 sticky top-0 z-10 bg-background/80 backdrop-blur-md">
          <div className="flex items-center gap-4">
            <h2 className="text-xl font-bold tracking-tight" data-testid="text-view-title">
              {view.charAt(0) + view.slice(1).toLowerCase()}
            </h2>
            <div className="flex items-center gap-3">
              <Badge variant={supabaseStatus === 'CONNECTED' ? 'default' : 'destructive'} className="text-[10px]">
                Cloud: {supabaseStatus}
              </Badge>
              <Badge variant={mexcStatus === 'CONNECTED' ? 'default' : 'destructive'} className="text-[10px]" data-testid="badge-mexc-status">
                MEXC: {mexcStatus}
              </Badge>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <div className="text-right">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Index Price</p>
              <p className="text-lg font-bold font-mono" data-testid="text-market-price">
                ${marketData?.price?.toLocaleString() || '0.00'}
              </p>
            </div>
            <Badge variant={settings.isLiveMode ? 'destructive' : 'secondary'} className="text-[10px] uppercase">
              {settings.isLiveMode ? 'Live Mode' : 'Simulation'}
            </Badge>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-8">
          {view === 'DASHBOARD' && (
            <div className="grid grid-cols-12 gap-8 max-w-7xl" data-testid="view-dashboard">
              <Card className="col-span-12 lg:col-span-8 p-6">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">
                    Price Momentum ({settings.tradingSymbol})
                  </h3>
                  <div className="flex items-center gap-2">
                    {marketData?.change24h !== undefined && (
                      <span className={`text-xs font-bold flex items-center gap-1 ${marketData.change24h >= 0 ? 'text-green-500' : 'text-destructive'}`}>
                        {marketData.change24h >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        {marketData.change24h >= 0 ? '+' : ''}{marketData.change24h?.toFixed(2)}%
                      </span>
                    )}
                  </div>
                </div>
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={marketData?.history || []}>
                      <defs>
                        <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.2}/>
                          <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" opacity={0.5} />
                      <XAxis dataKey="time" hide />
                      <YAxis domain={['auto', 'auto']} hide />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: 'hsl(var(--card))', 
                          border: '1px solid hsl(var(--border))', 
                          borderRadius: '8px',
                          color: 'hsl(var(--foreground))'
                        }} 
                      />
                      <Area 
                        type="monotone" 
                        dataKey="price" 
                        stroke="hsl(var(--primary))" 
                        fillOpacity={1} 
                        fill="url(#colorPrice)" 
                        strokeWidth={2} 
                        isAnimationActive={false} 
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <div className="col-span-12 lg:col-span-4 flex flex-col gap-8">
                <Card className="p-6 flex-1">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">AI Signal</h3>
                    {isAnalyzing && <RefreshCw className="w-4 h-4 animate-spin text-primary" />}
                  </div>
                  {!lastAction ? (
                    <div className="h-full flex flex-col items-center justify-center text-center py-12">
                      <Bot className="w-12 h-12 text-muted-foreground/30 mb-3" />
                      <p className="text-xs text-muted-foreground">Awaiting market signal...</p>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      <div className={`p-4 rounded-lg text-center border ${
                        lastAction.action === 'LONG' ? 'bg-green-500/10 border-green-500/20 text-green-500' :
                        lastAction.action === 'SHORT' ? 'bg-destructive/10 border-destructive/20 text-destructive' : 
                        'bg-muted text-muted-foreground'
                      }`}>
                        <p className="text-2xl font-black uppercase tracking-tight" data-testid="text-ai-action">
                          {lastAction.action}
                        </p>
                        <p className="text-[10px] font-bold opacity-60 mt-1 uppercase">
                          Confidence: {lastAction.confidence}%
                        </p>
                      </div>
                      <Card className="p-4 bg-muted/50">
                        <p className="text-xs text-muted-foreground leading-relaxed italic">
                          "{lastAction.reason}"
                        </p>
                      </Card>
                    </div>
                  )}
                </Card>

                <Card className="p-6">
                  <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-4">
                    Active Vectors
                  </h4>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-muted-foreground">Symbol</span>
                      <span className="font-bold">{settings.tradingSymbol}</span>
                    </div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-muted-foreground">Leverage</span>
                      <span className="font-bold">{settings.defaultLeverage}x</span>
                    </div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-muted-foreground">Pulse</span>
                      <span className="font-bold">{settings.intervalMinutes}m</span>
                    </div>
                  </div>
                </Card>
              </div>
            </div>
          )}

          {view === 'PORTFOLIO' && (
            <div className="max-w-7xl space-y-6" data-testid="view-portfolio">
              <Tabs value={accountSubView} onValueChange={(v) => setAccountSubView(v as AccountSubView)}>
                <TabsList className="mb-8">
                  {(['BALANCES', 'POSITIONS', 'ORDERS', 'HISTORY'] as const).map(tab => (
                    <TabsTrigger key={tab} value={tab} className="uppercase text-xs tracking-widest">
                      {tab}
                    </TabsTrigger>
                  ))}
                </TabsList>

                <TabsContent value="BALANCES">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <Card className="p-6">
                      <h4 className="text-xs font-bold text-muted-foreground uppercase mb-6 tracking-wider">
                        Futures Account
                      </h4>
                      <div className="space-y-4">
                        {futuresBalances.length > 0 ? futuresBalances.map(b => (
                          <div key={b.asset} className="flex justify-between items-center p-3 hover-elevate rounded-lg">
                            <span className="font-bold">{b.asset}</span>
                            <div className="text-right">
                              <span className="block text-sm font-bold">{Number(b.total).toFixed(2)}</span>
                              <span className="block text-[10px] text-muted-foreground uppercase">
                                Available: {b.available}
                              </span>
                            </div>
                          </div>
                        )) : (
                          <p className="text-xs text-muted-foreground py-4 text-center">No futures balance found.</p>
                        )}
                      </div>
                    </Card>
                    <Card className="p-6">
                      <h4 className="text-xs font-bold text-muted-foreground uppercase mb-6 tracking-wider">
                        Spot Wallet
                      </h4>
                      <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
                        {spotBalances.length > 0 ? spotBalances.map(b => (
                          <div key={b.asset} className="flex justify-between items-center p-2.5 hover-elevate rounded-lg">
                            <span className="text-sm font-semibold text-muted-foreground">{b.asset}</span>
                            <span className="text-sm font-mono">{Number(b.total).toFixed(4)}</span>
                          </div>
                        )) : (
                          <p className="text-xs text-muted-foreground py-4 text-center">No spot balance found.</p>
                        )}
                      </div>
                    </Card>
                  </div>
                </TabsContent>

                <TabsContent value="POSITIONS">
                  <Card className="overflow-hidden">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-muted text-muted-foreground text-[10px] font-bold uppercase tracking-widest border-b border-border">
                        <tr>
                          <th className="px-6 py-4">Symbol</th>
                          <th className="px-6 py-4">Side</th>
                          <th className="px-6 py-4">Leverage</th>
                          <th className="px-6 py-4">Entry</th>
                          <th className="px-6 py-4">Current</th>
                          <th className="px-6 py-4">PnL (USDT)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {mexcPositions.map(pos => (
                          <tr key={pos.id} className="hover-elevate">
                            <td className="px-6 py-4 font-bold">{pos.symbol}</td>
                            <td className={`px-6 py-4 font-bold ${pos.side === 'LONG' ? 'text-green-500' : 'text-destructive'}`}>
                              {pos.side}
                            </td>
                            <td className="px-6 py-4 text-muted-foreground">{pos.leverage}x</td>
                            <td className="px-6 py-4 font-mono text-xs">{pos.entryPrice}</td>
                            <td className="px-6 py-4 font-mono text-xs">{pos.currentPrice}</td>
                            <td className={`px-6 py-4 font-bold ${pos.pnl >= 0 ? 'text-green-500' : 'text-destructive'}`}>
                              {pos.pnl >= 0 ? '+' : ''}{pos.pnl.toFixed(2)}
                            </td>
                          </tr>
                        ))}
                        {mexcPositions.length === 0 && (
                          <tr>
                            <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground italic">
                              No active positions.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </Card>
                </TabsContent>

                <TabsContent value="ORDERS">
                  <Card className="overflow-hidden">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-muted text-muted-foreground text-[10px] font-bold uppercase tracking-widest border-b border-border">
                        <tr>
                          <th className="px-6 py-4">Order ID</th>
                          <th className="px-6 py-4">Symbol</th>
                          <th className="px-6 py-4">Side</th>
                          <th className="px-6 py-4">Price</th>
                          <th className="px-6 py-4">Quantity</th>
                          <th className="px-6 py-4">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {mexcOrders.map(order => (
                          <tr key={order.orderId} className="hover-elevate">
                            <td className="px-6 py-4 font-mono text-xs">{order.orderId}</td>
                            <td className="px-6 py-4 font-bold">{order.symbol}</td>
                            <td className={`px-6 py-4 font-bold ${order.side === 'BUY' ? 'text-green-500' : 'text-destructive'}`}>
                              {order.side}
                            </td>
                            <td className="px-6 py-4 font-mono">{order.price}</td>
                            <td className="px-6 py-4">{order.quantity}</td>
                            <td className="px-6 py-4">
                              <Badge variant="secondary">{order.status}</Badge>
                            </td>
                          </tr>
                        ))}
                        {mexcOrders.length === 0 && (
                          <tr>
                            <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground italic">
                              No open orders.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </Card>
                </TabsContent>

                <TabsContent value="HISTORY">
                  <Card className="overflow-hidden">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-muted text-muted-foreground text-[10px] font-bold uppercase tracking-widest border-b border-border">
                        <tr>
                          <th className="px-6 py-4">Trade ID</th>
                          <th className="px-6 py-4">Symbol</th>
                          <th className="px-6 py-4">Side</th>
                          <th className="px-6 py-4">Price</th>
                          <th className="px-6 py-4">Quantity</th>
                          <th className="px-6 py-4">PnL</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {mexcTrades.map(trade => (
                          <tr key={trade.id} className="hover-elevate">
                            <td className="px-6 py-4 font-mono text-xs">{trade.id}</td>
                            <td className="px-6 py-4 font-bold">{trade.symbol}</td>
                            <td className={`px-6 py-4 font-bold ${trade.side === 'BUY' ? 'text-green-500' : 'text-destructive'}`}>
                              {trade.side}
                            </td>
                            <td className="px-6 py-4 font-mono">{trade.price}</td>
                            <td className="px-6 py-4">{trade.quantity}</td>
                            <td className={`px-6 py-4 font-bold ${trade.pnl >= 0 ? 'text-green-500' : 'text-destructive'}`}>
                              {trade.pnl >= 0 ? '+' : ''}{trade.pnl.toFixed(2)}
                            </td>
                          </tr>
                        ))}
                        {mexcTrades.length === 0 && (
                          <tr>
                            <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground italic">
                              No trade history.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </Card>
                </TabsContent>
              </Tabs>
            </div>
          )}

          {view === 'SETTINGS' && (
            <div className="max-w-4xl space-y-8 pb-20" data-testid="view-settings">
              <Card className="p-8">
                <div className="flex justify-between items-center mb-10 flex-wrap gap-4">
                  <h3 className="text-xl font-bold tracking-tight">Bot Configuration</h3>
                  <div className="flex items-center gap-4">
                    {saveStatus && <span className="text-green-500 text-xs font-bold animate-pulse">{saveStatus}</span>}
                    <Button onClick={handleSave} data-testid="button-save-settings">Save Changes</Button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                  <div className="space-y-6">
                    <div>
                      <label className="block text-[10px] font-bold text-muted-foreground uppercase mb-2 tracking-widest">
                        AI Intelligence
                      </label>
                      <Select 
                        value={settings.aiProvider} 
                        onValueChange={(v) => setSettings(s => ({ ...s, aiProvider: v as AIProvider }))}
                      >
                        <SelectTrigger data-testid="select-ai-provider">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="gemini">Gemini Pro</SelectItem>
                          <SelectItem value="openai">OpenAI GPT-4</SelectItem>
                          <SelectItem value="deepseek">DeepSeek V3</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input 
                        type="password" 
                        placeholder="AI API Key" 
                        className="mt-3 font-mono"
                        value={settings.aiProvider === 'gemini' ? settings.geminiApiKey : settings.aiProvider === 'openai' ? settings.openaiApiKey : settings.deepseekApiKey} 
                        onChange={e => setSettings(s => ({ ...s, 
                          geminiApiKey: s.aiProvider === 'gemini' ? e.target.value : s.geminiApiKey,
                          openaiApiKey: s.aiProvider === 'openai' ? e.target.value : s.openaiApiKey,
                          deepseekApiKey: s.aiProvider === 'deepseek' ? e.target.value : s.deepseekApiKey
                        }))}
                        data-testid="input-ai-api-key"
                      />
                    </div>
                  </div>

                  <div className="space-y-6">
                    <div>
                      <label className="block text-[10px] font-bold text-muted-foreground uppercase mb-2 tracking-widest">
                        MEXC Integration
                      </label>
                      <Select 
                        value={settings.isLiveMode ? 'live' : 'sim'} 
                        onValueChange={(v) => setSettings(s => ({ ...s, isLiveMode: v === 'live' }))}
                      >
                        <SelectTrigger data-testid="select-trading-mode">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="sim">Simulation Mode</SelectItem>
                          <SelectItem value="live">Live Trading Mode</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input 
                        type="password" 
                        placeholder="MEXC API Key" 
                        value={settings.mexcApiKey} 
                        onChange={e => setSettings(s => ({ ...s, mexcApiKey: e.target.value }))} 
                        className="mt-3 font-mono"
                        data-testid="input-mexc-api-key"
                      />
                      <Input 
                        type="password" 
                        placeholder="MEXC Secret Key" 
                        value={settings.mexcSecretKey} 
                        onChange={e => setSettings(s => ({ ...s, mexcSecretKey: e.target.value }))} 
                        className="mt-3 font-mono"
                        data-testid="input-mexc-secret-key"
                      />
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[10px] font-bold text-muted-foreground uppercase mb-2">Symbol</label>
                        <Input 
                          value={settings.tradingSymbol} 
                          onChange={e => setSettings(s => ({ ...s, tradingSymbol: e.target.value.toUpperCase() }))} 
                          className="font-bold text-center uppercase"
                          data-testid="input-trading-symbol"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-muted-foreground uppercase mb-2">Pulse (Min)</label>
                        <Input 
                          type="number" 
                          min="1" 
                          value={settings.intervalMinutes} 
                          onChange={e => setSettings(s => ({ ...s, intervalMinutes: Math.max(1, parseInt(e.target.value) || 1) }))} 
                          className="font-bold text-center"
                          data-testid="input-interval"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[10px] font-bold text-muted-foreground uppercase mb-2">Leverage</label>
                        <Input 
                          type="number" 
                          min="1" 
                          max="125"
                          value={settings.defaultLeverage} 
                          onChange={e => setSettings(s => ({ ...s, defaultLeverage: Math.min(125, Math.max(1, parseInt(e.target.value) || 1)) }))} 
                          className="font-bold text-center"
                          data-testid="input-leverage"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-muted-foreground uppercase mb-2">Risk %</label>
                        <Input 
                          type="number" 
                          min="1" 
                          max="100"
                          value={settings.riskPercent} 
                          onChange={e => setSettings(s => ({ ...s, riskPercent: Math.min(100, Math.max(1, parseInt(e.target.value) || 1)) }))} 
                          className="font-bold text-center"
                          data-testid="input-risk-percent"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </Card>
            </div>
          )}

          {view === 'CLOUD' && (
            <div className="max-w-4xl space-y-8" data-testid="view-cloud">
              <Card className="p-8">
                <div className="flex justify-between items-center mb-8 pb-8 border-b border-border flex-wrap gap-4">
                  <h3 className="text-xl font-bold tracking-tight">Supabase Sync</h3>
                  <Badge variant={supabaseStatus === 'CONNECTED' ? 'default' : 'secondary'}>
                    {supabaseStatus}
                  </Badge>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
                  <div>
                    <label className="block text-[10px] font-bold text-muted-foreground uppercase mb-2 tracking-widest">
                      Gateway URL
                    </label>
                    <Input 
                      type="text" 
                      value={settings.supabaseUrl} 
                      onChange={e => setSettings(s => ({ ...s, supabaseUrl: e.target.value }))}
                      className="font-mono text-xs"
                      placeholder="https://your-project.supabase.co"
                      data-testid="input-supabase-url"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-muted-foreground uppercase mb-2 tracking-widest">
                      Anon Key
                    </label>
                    <Input 
                      type="password" 
                      value={settings.supabaseAnonKey} 
                      onChange={e => setSettings(s => ({ ...s, supabaseAnonKey: e.target.value }))}
                      className="font-mono text-xs"
                      placeholder="Your anon key"
                      data-testid="input-supabase-key"
                    />
                  </div>
                </div>

                <div className="space-y-4">
                  <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
                    Database Schema Required
                  </h4>
                  <Card className="p-6 bg-muted/50 overflow-x-auto">
                    <pre className="font-mono text-[11px] text-primary leading-relaxed whitespace-pre-wrap">
{`CREATE TABLE aegis_settings (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  key TEXT UNIQUE NOT NULL,
  value TEXT NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE aegis_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  type TEXT NOT NULL,
  message TEXT NOT NULL
);`}
                    </pre>
                  </Card>
                </div>
              </Card>
            </div>
          )}

          {view === 'LOGS' && (
            <div className="max-w-7xl h-[calc(100vh-200px)]" data-testid="view-logs">
              <Card className="h-full flex flex-col overflow-hidden">
                <div className="px-8 py-4 border-b border-border flex justify-between items-center flex-wrap gap-2">
                  <span className="text-xs font-bold text-primary uppercase tracking-widest">Activity Stream</span>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => setLogs([])}
                    className="text-muted-foreground"
                    data-testid="button-clear-logs"
                  >
                    Clear Stream
                  </Button>
                </div>
                <div className="flex-1 overflow-y-auto px-8 py-6 font-mono text-[11px] space-y-3">
                  {logs.map(log => (
                    <div key={log.id} className="flex gap-6 border-b border-border/30 pb-2">
                      <span className="text-muted-foreground shrink-0">[{log.timestamp}]</span>
                      <span className={`font-bold w-20 shrink-0 ${
                        log.type === 'ERROR' ? 'text-destructive' : 
                        log.type === 'SUCCESS' ? 'text-green-500' : 
                        log.type === 'TRADE' ? 'text-chart-4' :
                        'text-primary'
                      }`}>
                        {log.type}
                      </span>
                      <span className="text-muted-foreground flex-1">{log.message}</span>
                    </div>
                  ))}
                  {logs.length === 0 && (
                    <div className="text-center text-muted-foreground py-32 text-xs italic">
                      Terminal stream idle.
                    </div>
                  )}
                </div>
              </Card>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
