import React from 'react';
import { Send, Mail, HelpCircle, ExternalLink, ShieldCheck } from 'lucide-react';
import { TELEGRAM_URL, APP_NAME, LOGO_URL } from './Sidebar';

export const ContactView: React.FC = () => {
  return (
    <div className="container mx-auto px-4 py-6 max-w-4xl">
      <div className="bg-background border border-border rounded-xl p-6 sm:p-8 shadow-xs space-y-8">
        {/* Brand header */}
        <div className="text-center space-y-3 pb-6 border-b border-border">
          <div className="w-16 h-16 rounded-full overflow-hidden mx-auto border-2 border-primary/20 p-1 shadow-sm">
            <img src={LOGO_URL} alt={APP_NAME} className="w-full h-full object-cover rounded-full" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-foreground tracking-tight">
            {APP_NAME} Support & Community
          </h1>
          <p className="text-sm text-muted-foreground max-w-lg mx-auto">
            Get 24/7 assistance, daily test updates, class notes, and join thousands of students on our official channel.
          </p>
        </div>

        {/* Telegram Direct Action Card */}
        <div className="rounded-xl bg-gradient-to-br from-blue-600 to-indigo-700 text-white p-6 shadow-md flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="space-y-1.5 text-center sm:text-left">
            <span className="inline-block bg-white/20 text-white text-[11px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider">
              Official Telegram Channel
            </span>
            <h3 className="text-xl font-bold">Join @GBFreestudy on Telegram</h3>
            <p className="text-xs text-blue-100 max-w-md">
              Instant access to free batches, live lecture alerts, DPP solutions, and student discussions.
            </p>
          </div>

          <a
            href={TELEGRAM_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-white text-blue-700 hover:bg-blue-50 font-bold px-6 py-3 rounded-xl transition-all shadow-md flex-shrink-0"
          >
            <Send className="w-4 h-4" />
            <span>Join Now Free</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>

        {/* FAQ grid */}
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
            <HelpCircle className="w-5 h-5 text-primary" />
            <span>Frequently Asked Questions</span>
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="border border-border rounded-lg p-4 bg-card">
              <h4 className="font-semibold text-foreground text-sm mb-1">Are all batches really 100% free?</h4>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Yes! Every single batch on GB STUDY is completely accessible free of charge for students preparing for IIT-JEE, NEET, CBSE, and other competitive exams.
              </p>
            </div>

            <div className="border border-border rounded-lg p-4 bg-card">
              <h4 className="font-semibold text-foreground text-sm mb-1">Where do I get Class Notes & DPPs?</h4>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Click on any batch, choose your subject and chapter to view or download high-quality lecture notes and practice problem sheets.
              </p>
            </div>

            <div className="border border-border rounded-lg p-4 bg-card">
              <h4 className="font-semibold text-foreground text-sm mb-1">How do I report a missing lecture?</h4>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Join our Telegram group at{' '}
                <a href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer" className="text-primary underline">
                  {TELEGRAM_URL}
                </a>{' '}
                and send your batch or lecture details to the admin team.
              </p>
            </div>

            <div className="border border-border rounded-lg p-4 bg-card">
              <h4 className="font-semibold text-foreground text-sm mb-1">Is GB STUDY mobile friendly?</h4>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Yes! The entire interface is optimized for smartphones, tablets, and desktops with dark mode support.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
