import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import Editor from "@monaco-editor/react";
import toast from "react-hot-toast";
import { ArrowLeft, Sparkles } from "lucide-react";
import api from "../lib/api";

const LANGUAGES = [
  "javascript", "typescript", "python", "java",
  "go", "rust", "cpp", "c", "csharp", "ruby",
  "php", "swift",
];

const STARTER_CODE = {
  javascript: `function fetchUserData(userId) {\n  var data = null;\n  fetch('/api/users/' + userId)\n    .then(function(res) { return res.json(); })\n    .then(function(json) { data = json; });\n  return data;\n}`,
  python: `def calculate_discount(price, discount):\n    result = price - (price * discount / 100)\n    print("Discounted price: " + result)\n    return result`,
  typescript: `interface User {\n  id: number\n  name: string\n}\n\nfunction getUser(id: number): User {\n  const users = [{ id: 1, name: "Alice" }];\n  return users.filter(u => u.id == id)[0];\n}`,
};

const NewReview = () => {
  const [form, setForm] = useState({
    title: "",
    language: "javascript",
    code: STARTER_CODE.javascript,
  });
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLanguageChange = (lang) => {
    setForm((f) => ({
      ...f,
      language: lang,
      code: STARTER_CODE[lang] || "",
    }));
  };

  const handleSubmit = async () => {
    if (!form.title.trim()) return toast.error("Please add a title");
    if (!form.code.trim() || form.code.length < 10)
      return toast.error("Code is too short");

    setLoading(true);
    try {
      const { data } = await api.post("/reviews", form);
      toast.success("Review queued! Streaming results...");
      navigate(`/review/${data.reviewId}`);
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to submit review");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Navbar */}
      <nav className="border-b border-[#313244] px-6 py-4 flex items-center gap-4 shrink-0">
        <Link to="/dashboard" className="text-[#6c7086] hover:text-[#cdd6f4]">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <span className="font-semibold">New Review</span>
      </nav>

      <div className="flex flex-col lg:flex-row flex-1 gap-0 overflow-hidden">
        {/* Left: Config panel */}
        <div className="lg:w-72 shrink-0 border-b lg:border-b-0 lg:border-r border-[#313244] p-6 space-y-5">
          <div>
            <label className="text-xs text-[#a6adc8] mb-1.5 block">Review Title</label>
            <input
              className="input"
              placeholder="e.g. Auth middleware check"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </div>

          <div>
            <label className="text-xs text-[#a6adc8] mb-1.5 block">Language</label>
            <div className="grid grid-cols-2 gap-1.5">
              {LANGUAGES.map((lang) => (
                <button
                  key={lang}
                  onClick={() => handleLanguageChange(lang)}
                  className={`text-xs px-3 py-1.5 rounded-md border transition-colors capitalize
                    ${form.language === lang
                      ? "border-brand-500 bg-brand-500/10 text-brand-500"
                      : "border-[#313244] text-[#6c7086] hover:border-[#45475a]"
                    }`}
                >
                  {lang}
                </button>
              ))}
            </div>
          </div>

          <div className="pt-2">
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              <Sparkles className="w-4 h-4" />
              {loading ? "Submitting..." : "Run AI Review"}
            </button>
            <p className="text-xs text-[#45475a] text-center mt-2">
              Uses Groq AI
            </p>
          </div>
        </div>

        {/* Right: Monaco Editor */}
        <div className="flex-1 overflow-hidden">
          <Editor
            height="100%"
            language={form.language === "cpp" ? "cpp" : form.language}
            value={form.code}
            onChange={(val) => setForm({ ...form, code: val || "" })}
            theme="vs-dark"
            options={{
              fontSize: 13,
              fontFamily: "JetBrains Mono, monospace",
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              lineNumbers: "on",
              padding: { top: 16, bottom: 16 },
              wordWrap: "on",
            }}
          />
        </div>
      </div>
    </div>
  );
};

export default NewReview;
