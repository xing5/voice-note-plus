import React from 'react';
import { LanguageSelector } from './LanguageSelector';

function SettingsModal({ isOpen, onClose, language, onLanguageChange }) {
  if (!isOpen) return null;
  
  const IS_WEBGPU_AVAILABLE = !!navigator.gpu;
  
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="elegant-card p-6 w-full max-w-lg">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-heading text-warm-800 dark:text-warm-200">Settings</h2>
          <button 
            onClick={onClose}
            className="text-warm-600 hover:text-warm-800 dark:text-warm-400 dark:hover:text-warm-200"
            aria-label="Close settings"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        <div className="space-y-6">
          {/* Language setting */}
          <div className="flex items-center justify-between">
            <label className="text-warm-700 dark:text-warm-300 font-serif">Language:</label>
            <LanguageSelector
              language={language}
              onChange={onLanguageChange}
            />
          </div>
          
          {/* WebGPU status */}
          <div className="flex items-center justify-between">
            <span className="text-warm-700 dark:text-warm-300 font-serif">WebGPU:</span>
            <span className={`font-serif ${IS_WEBGPU_AVAILABLE ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
              {IS_WEBGPU_AVAILABLE ? 'Enabled' : 'Not supported'}
            </span>
          </div>
        </div>
        
        <div className="mt-8 flex justify-end">
          <button 
            onClick={onClose}
            className="elegant-button"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default SettingsModal; 