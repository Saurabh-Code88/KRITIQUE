import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { ArrowLeft, Loader, CheckCircle, XCircle, Copy, Check } from "lucide-react";
import api from "../lib/api";
import useSSE from "../hooks/useSSE";

const StatusBadge = ({ status }) => {
  const map = {
    PENDING: { icon: Loader, text: "Pending", color: "text-yellow-400" },
    PROCESSING: { icon: Loader, text: "Analyzing...", color: "text-blue-400", spin: true },
    COMPLETED: { icon: CheckCircle, text: "Completed", color: "text-brand-500" },
    FAILED: { icon: XCircle, text: "Failed", color: "text-red-400" },
  };
  const cfg = map[status] || map.PENDING;
  const Icon = cfg.icon;

  return (
    <span className={`flex items-center gap-1.5 text-sm ${cfg.color}`}>
      <Icon className={`w-4 h-4 ${cfg.spin ? "animate-spin" : ""}`} />
      {cfg.text}
    </span>
  );
};

const ReviewPage = () => {
  const { id } = useParams();
  const [review, setReview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  // SSE hook: streams tokens when review is PENDING/PROCESSING
  const { content: streamContent, status: streamStatus } = useSSE(
    review?.status !== "COMPLETED" ? id : null
  );

  // Fetch review metadata
  useEffect(() => {
    const fetch = async () => {
      try {
        const { data } = await api.get(`/reviews/${id}`);
        setReview(data.review);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetch();
    // Poll until completed
    const interval = setInterval(async () => {
      const { data } = await api.get(`/reviews/${id}`).catch(() => ({ data: null }));
      if (data?.review) {
        setReview(data.review);
        if (["COMPLETED", "FAILED"].includes(data.review.status)) {
          clearInterval(interval);
        }
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [id]);

  useEffect(() => {
    if (streamStatus === "done") {
      setReview((current) =>
        current && ["PENDING", "PROCESSING"].includes(current.status)
          ? { ...current, status: "COMPLETED", result: streamContent || current.result }
          : current
      );
    }

    if (streamStatus === "error") {
      setReview((current) =>
        current && ["PENDING", "PROCESSING"].includes(current.status)
          ? { ...current, status: "FAILED" }
          : current
      );
    }
  }, [streamStatus, streamContent]);

  const displayContent =
    review?.status === "COMPLETED"
      ? review.result  // Use saved result for completed reviews
      : streamContent; // Use live stream for active reviews

  const copyCode = async () => {
    if (!review?.code) return;
    await navigator.clipboard.writeText(review.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader className="w-6 h-6 animate-spin text-[#6c7086]" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Navbar */}
      <nav className="border-b border-[#313244] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/dashboard" className="text-[#6c7086] hover:text-[#cdd6f4]">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="font-semibold text-[#cdd6f4]">
              {review?.title || "Review"}
            </h1>
            <p className="text-xs text-[#6c7086]">
              {review?.language} -{" "}
              {review?.createdAt
                ? new Date(review.createdAt).toLocaleString()
                : ""}
            </p>
          </div>
        </div>
        <StatusBadge status={review?.status || "PENDING"} />
      </nav>

      <div className="flex flex-col lg:flex-row flex-1 overflow-hidden">
        {/* Left: Original code */}
        <div className="lg:w-1/2 border-b lg:border-b-0 lg:border-r border-[#313244] flex flex-col">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#313244]">
            <span className="text-xs text-[#6c7086] font-mono uppercase tracking-wider">
              Code
            </span>
            <button
              onClick={copyCode}
              className="text-[#6c7086] hover:text-[#cdd6f4] transition-colors"
            >
              {copied ? (
                <Check className="w-4 h-4 text-brand-500" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </button>
          </div>
          <pre className="flex-1 overflow-auto p-4 text-sm font-mono text-[#cdd6f4] leading-relaxed whitespace-pre-wrap">
            <code>{review?.code}</code>
          </pre>
        </div>

        {/* Right: AI Review (streaming) */}
        <div className="lg:w-1/2 flex flex-col overflow-hidden">
          <div className="flex items-center px-4 py-2.5 border-b border-[#313244]">
            <span className="text-xs text-[#6c7086] font-mono uppercase tracking-wider">
              AI Review
            </span>
            {["connecting", "streaming"].includes(streamStatus) && (
              <span className="ml-2 inline-flex items-center gap-1 text-xs text-blue-400">
                <span className="inline-block w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />
                Live
              </span>
            )}
          </div>

          <div className="flex-1 overflow-auto p-6">
            {!displayContent && review?.status === "PENDING" && (
              <div className="flex flex-col items-center justify-center h-full text-center gap-3">
                <Loader className="w-6 h-6 animate-spin text-[#6c7086]" />
                <p className="text-sm text-[#6c7086]">
                  Queued for review...
                </p>
              </div>
            )}

            {displayContent && (
              <div className="review-content">
                <ReactMarkdown>{displayContent}</ReactMarkdown>
                {["connecting", "streaming"].includes(streamStatus) && (
                  <span className="inline-block w-2 h-4 bg-brand-500 animate-pulse ml-0.5 align-text-bottom" />
                )}
              </div>
            )}

            {review?.status === "FAILED" && !displayContent && (
              <div className="flex flex-col items-center justify-center h-full text-center gap-3">
                <XCircle className="w-8 h-8 text-red-400" />
                <p className="text-sm text-red-400">Review failed. Please try again.</p>
                <Link to="/new" className="btn-primary text-sm">
                  New Review
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReviewPage;
