import { useEffect, useRef, useState } from "react";
import { API_BASE_URL } from "../lib/config";

/**
 * useSSE — connects to /api/stream/:reviewId via Server-Sent Events
 * Accumulates streamed tokens and tracks connection state.
 *
 * @param {string|null} reviewId - the review to stream
 * @returns {{ content, status, error }}
 */
const useSSE = (reviewId) => {
  const [content, setContent] = useState("");
  const [status, setStatus] = useState("idle"); // idle | connecting | streaming | done | error
  const [error, setError] = useState(null);
  const esRef = useRef(null);

  useEffect(() => {
    if (!reviewId) return;

    const token = localStorage.getItem("token");
    if (!token) return;

    setContent("");
    setError(null);
    setStatus("connecting");

    const url = `${API_BASE_URL}/stream/${reviewId}?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => {
      setStatus("streaming");
    };

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === "token") {
          setContent((prev) => prev + data.text);
        } else if (data.type === "snapshot") {
          setContent(data.text);
        } else if (data.type === "done") {
          setStatus("done");
          es.close();
        } else if (data.type === "error") {
          setError(data.message || "Review failed");
          setStatus("error");
          es.close();
        }
      } catch (e) {
        console.error("SSE parse error:", e);
      }
    };

    es.onerror = () => {
      setError("Connection lost. Please refresh.");
      setStatus("error");
      es.close();
    };

    return () => {
      es.close();
    };
  }, [reviewId]);

  return { content, status, error };
};

export default useSSE;
