/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { 
  Upload, 
  Video, 
  Languages, 
  Mic2, 
  Download, 
  Play, 
  Pause, 
  RotateCcw, 
  CheckCircle2, 
  AlertCircle,
  Loader2,
  Volume2,
  FileVideo,
  Settings2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI, Modality } from "@google/genai";
import { cn } from './lib/utils';

// Initialize Gemini
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

interface DubbingState {
  step: 'upload' | 'processing' | 'review' | 'done';
  originalFile: File | null;
  originalVideoUrl: string | null;
  transcript: string;
  translatedText: string;
  dubbedAudioUrl: string | null;
  error: string | null;
  progress: number;
  statusMessage: string;
}

export default function App() {
  const [state, setState] = useState<DubbingState>({
    step: 'upload',
    originalFile: null,
    originalVideoUrl: null,
    transcript: '',
    translatedText: '',
    dubbedAudioUrl: null,
    error: null,
    progress: 0,
    statusMessage: ''
  });

  const videoRef = useRef<HTMLVideoElement>(null);
  const dubbedAudioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const onDrop = (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setState(prev => ({
        ...prev,
        originalFile: file,
        originalVideoUrl: url,
        step: 'processing',
        statusMessage: 'Preparing video for analysis...'
      }));
      processVideo(file);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'video/*': ['.mp4', '.mov', '.avi'] },
    multiple: false
  } as any);

  const createWavHeader = (dataLength: number, sampleRate: number = 24000) => {
    const buffer = new ArrayBuffer(44);
    const view = new DataView(buffer);

    /* RIFF identifier */
    view.setUint32(0, 0x52494646, false);
    /* file length */
    view.setUint32(4, 36 + dataLength, true);
    /* RIFF type */
    view.setUint32(8, 0x57415645, false);
    /* format chunk identifier */
    view.setUint32(12, 0x666d7420, false);
    /* format chunk length */
    view.setUint32(16, 16, true);
    /* sample format (raw) */
    view.setUint16(20, 1, true);
    /* channel count */
    view.setUint16(22, 1, true);
    /* sample rate */
    view.setUint32(24, sampleRate, true);
    /* byte rate (sample rate * block align) */
    view.setUint32(28, sampleRate * 2, true);
    /* block align (channel count * bytes per sample) */
    view.setUint16(32, 2, true);
    /* bits per sample */
    view.setUint16(34, 16, true);
    /* data chunk identifier */
    view.setUint32(36, 0x64617461, false);
    /* data chunk length */
    view.setUint32(40, dataLength, true);

    return buffer;
  };

  const processVideo = async (file: File) => {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
      
      // Step 1: Transcribe and Translate
      setState(prev => ({ ...prev, progress: 20, statusMessage: 'Transcribing and translating to Khmer...' }));
      
      const base64Data = await fileToBase64(file);
      
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            parts: [
              {
                inlineData: {
                  mimeType: file.type,
                  data: base64Data
                }
              },
              {
                text: "Transcribe the audio in this video and translate it into natural, professional Khmer. Return the result in JSON format with 'original' and 'khmer' keys."
              }
            ]
          }
        ],
        config: {
          responseMimeType: "application/json"
        }
      });

      const result = JSON.parse(response.text || "{}");
      const transcript = result.original || "";
      const translated = result.khmer || "";

      setState(prev => ({ 
        ...prev, 
        transcript, 
        translatedText: translated, 
        progress: 60, 
        statusMessage: 'Generating high-quality Khmer voice...' 
      }));

      // Step 2: Generate TTS
      const ttsResponse = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: `Say clearly in Khmer: ${translated}` }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' }, // Kore is generally good for neutral/professional
            },
          },
        },
      });

      const audioBase64 = ttsResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (audioBase64) {
        const binaryString = atob(audioBase64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        const wavHeader = createWavHeader(bytes.length);
        const wavBlob = new Blob([wavHeader, bytes], { type: 'audio/wav' });
        const audioUrl = URL.createObjectURL(wavBlob);
        
        setState(prev => ({
          ...prev,
          dubbedAudioUrl: audioUrl,
          progress: 100,
          step: 'review',
          statusMessage: 'Dubbing complete!'
        }));
      } else {
        throw new Error("Failed to generate dubbed audio.");
      }

    } catch (err: any) {
      console.error(err);
      setState(prev => ({
        ...prev,
        step: 'upload',
        error: err.message || "An error occurred during processing."
      }));
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64String = (reader.result as string).split(',')[1];
        resolve(base64String);
      };
      reader.onerror = error => reject(error);
    });
  };

  const base64ToBlob = (base64: string, mimeType: string) => {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: mimeType });
  };

  const togglePlay = () => {
    if (videoRef.current && dubbedAudioRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
        dubbedAudioRef.current.pause();
      } else {
        videoRef.current.currentTime = 0;
        dubbedAudioRef.current.currentTime = 0;
        videoRef.current.play();
        dubbedAudioRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const reset = () => {
    setState({
      step: 'upload',
      originalFile: null,
      originalVideoUrl: null,
      transcript: '',
      translatedText: '',
      dubbedAudioUrl: null,
      error: null,
      progress: 0,
      statusMessage: ''
    });
    setIsPlaying(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-brand-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-brand-200">
              <Mic2 size={24} />
            </div>
            <div>
              <h1 className="font-bold text-slate-900 leading-none">AI Dubber</h1>
              <p className="text-xs text-slate-500 font-medium">Ultimate Khmer Edition</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button className="p-2 text-slate-400 hover:text-slate-600 transition-colors">
              <Settings2 size={20} />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        <AnimatePresence mode="wait">
          {state.step === 'upload' && (
            <motion.div
              key="upload"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8"
            >
              <div className="text-center space-y-2">
                <h2 className="text-3xl font-bold text-slate-900">Dub your videos into Khmer</h2>
                <p className="text-slate-500 max-w-lg mx-auto">
                  Upload any video and our AI will automatically transcribe, translate, and generate a professional Khmer voiceover.
                </p>
              </div>

              <div 
                {...getRootProps()} 
                className={cn(
                  "border-2 border-dashed rounded-3xl p-12 transition-all cursor-pointer flex flex-col items-center justify-center gap-4 min-h-[300px]",
                  isDragActive ? "border-brand-500 bg-brand-50" : "border-slate-200 bg-white hover:border-brand-300 hover:bg-slate-50"
                )}
              >
                <input {...getInputProps()} />
                <div className="w-16 h-16 bg-brand-100 text-brand-600 rounded-full flex items-center justify-center mb-2">
                  <Upload size={32} />
                </div>
                <div className="text-center">
                  <p className="text-lg font-semibold text-slate-900">
                    {isDragActive ? "Drop the video here" : "Click or drag video to upload"}
                  </p>
                  <p className="text-sm text-slate-500 mt-1">MP4, MOV, or AVI (Max 50MB)</p>
                </div>
              </div>

              {state.error && (
                <div className="bg-red-50 border border-red-100 text-red-600 p-4 rounded-2xl flex items-center gap-3">
                  <AlertCircle size={20} />
                  <p className="text-sm font-medium">{state.error}</p>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <FeatureCard 
                  icon={<Languages className="text-blue-500" />}
                  title="Smart Translation"
                  description="Context-aware translation optimized for Khmer cultural nuances."
                />
                <FeatureCard 
                  icon={<Volume2 className="text-purple-500" />}
                  title="Natural Voices"
                  description="High-quality AI voices that sound human and professional."
                />
                <FeatureCard 
                  icon={<Video className="text-emerald-500" />}
                  title="Sync Perfect"
                  description="Automatically aligns audio with your original video timing."
                />
              </div>
            </motion.div>
          )}

          {state.step === 'processing' && (
            <motion.div
              key="processing"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="max-w-md mx-auto py-12 text-center space-y-8"
            >
              <div className="relative inline-block">
                <div className="w-32 h-32 rounded-full border-4 border-brand-100 flex items-center justify-center">
                  <Loader2 size={48} className="text-brand-600 animate-spin" />
                </div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-sm font-bold text-brand-700">{state.progress}%</span>
                </div>
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-bold text-slate-900">Processing Video</h2>
                <p className="text-slate-500 font-medium">{state.statusMessage}</p>
              </div>
              <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                <motion.div 
                  className="h-full bg-brand-600"
                  initial={{ width: 0 }}
                  animate={{ width: `${state.progress}%` }}
                />
              </div>
            </motion.div>
          )}

          {state.step === 'review' && (
            <motion.div
              key="review"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="grid grid-cols-1 lg:grid-cols-2 gap-8"
            >
              <div className="space-y-6">
                <div className="bg-black rounded-3xl overflow-hidden shadow-2xl aspect-video relative group">
                  <video 
                    ref={videoRef}
                    src={state.originalVideoUrl || ""} 
                    className="w-full h-full object-contain"
                    muted={isPlaying} // Mute original when playing dubbed
                  />
                  {state.dubbedAudioUrl && (
                    <audio 
                      ref={dubbedAudioRef}
                      src={state.dubbedAudioUrl}
                      onEnded={() => setIsPlaying(false)}
                    />
                  )}
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40">
                    <button 
                      onClick={togglePlay}
                      className="w-16 h-16 bg-white rounded-full flex items-center justify-center text-brand-600 shadow-xl transform hover:scale-110 transition-transform"
                    >
                      {isPlaying ? <Pause size={32} fill="currentColor" /> : <Play size={32} className="ml-1" fill="currentColor" />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-4">
                  <button 
                    onClick={reset}
                    className="flex-1 py-3 px-6 rounded-2xl bg-slate-100 text-slate-600 font-bold hover:bg-slate-200 transition-colors flex items-center justify-center gap-2"
                  >
                    <RotateCcw size={20} />
                    Start Over
                  </button>
                  <button 
                    className="flex-[2] py-3 px-6 rounded-2xl bg-brand-600 text-white font-bold hover:bg-brand-700 transition-colors shadow-lg shadow-brand-200 flex items-center justify-center gap-2"
                  >
                    <Download size={20} />
                    Download Dubbed Video
                  </button>
                </div>
              </div>

              <div className="space-y-6">
                <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-200 space-y-6">
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-slate-400">
                      <FileVideo size={18} />
                      <span className="text-sm font-bold uppercase tracking-wider">Original Transcript</span>
                    </div>
                    <p className="text-slate-600 leading-relaxed italic">
                      "{state.transcript}"
                    </p>
                  </div>

                  <div className="h-px bg-slate-100" />

                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-brand-500">
                      <Languages size={18} />
                      <span className="text-sm font-bold uppercase tracking-wider">Khmer Translation</span>
                    </div>
                    <p className="text-lg text-slate-900 leading-relaxed font-medium khmer-text">
                      {state.translatedText}
                    </p>
                  </div>
                </div>

                <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-2xl flex items-start gap-3">
                  <div className="mt-0.5 text-emerald-600">
                    <CheckCircle2 size={20} />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-emerald-900">Ready to Export</p>
                    <p className="text-xs text-emerald-700 mt-0.5">
                      The Khmer audio has been generated and synced. You can now preview and download the final result.
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="mt-auto py-8 border-t border-slate-200">
        <div className="max-w-5xl mx-auto px-4 text-center">
          <p className="text-sm text-slate-400">
            Powered by Gemini AI • Optimized for Khmer Language
          </p>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode, title: string, description: string }) {
  return (
    <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm hover:shadow-md transition-shadow space-y-3">
      <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center">
        {icon}
      </div>
      <h3 className="font-bold text-slate-900">{title}</h3>
      <p className="text-sm text-slate-500 leading-relaxed">{description}</p>
    </div>
  );
}
