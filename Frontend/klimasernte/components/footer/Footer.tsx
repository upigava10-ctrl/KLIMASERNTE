import Link from 'next/link';

export const Footer = () => {
  return (
    <footer className="bg-slate-50 border-t border-emerald-100 mt-auto">
      <div className="max-w-6xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4">
          
          {/* Center: Quick Links */}
          <div className="flex gap-6 text-sm font-medium text-slate-500">
          </div>

          {/* Right Side: Copyright */}
          <div className="text-sm text-slate-400 text-center md:text-right">
            <p>&copy; 2026 Klimasernte. Todos los derechos reservados.</p>
          </div>

        </div>
      </div>
    </footer>
  );
};