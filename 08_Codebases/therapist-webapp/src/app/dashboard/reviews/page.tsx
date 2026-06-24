"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/context";
import {
  Star, MessageCircle, Send,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Spinner";
import { LoadingContainer } from "@/components/ui/LoadingContainer";
import { DisplayHeading } from "@/components/ui/DisplayHeading";

type Review = {
  id: string;
  booking_id: string;
  client_id: string;
  therapist_id: string;
  client_name: string;
  client_photo_url: string | null;
  rating: number;
  text: string | null;
  therapist_reply: string | null;
  therapist_reply_date: string | null;
  is_flagged: boolean;
  created_at: string;
};

type SortOption = "recent" | "highest" | "lowest";

function Stars({ rating, size = "sm" }: { rating: number; size?: "sm" | "lg" }) {
  const sizeClass = size === "lg" ? "h-5 w-5" : "h-3.5 w-3.5";
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((s) => (
        <Star
          key={s}
          className={`${sizeClass} ${s <= rating ? "text-gold fill-gold" : "text-charcoal-muted/20"}`}
          strokeWidth={1.5}
        />
      ))}
    </div>
  );
}

export default function ReviewsPage() {
  const { t } = useI18n();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [avgRating, setAvgRating] = useState(0);
  const [totalReviews, setTotalReviews] = useState(0);
  const [sortBy, setSortBy] = useState<SortOption>("recent");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [sendingReply, setSendingReply] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [ratingDistribution, setRatingDistribution] = useState<number[]>([0, 0, 0, 0, 0]);
  const [referenceNow, setReferenceNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;

    async function loadReviews() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;

      let query = supabase
        .from("reviews")
        .select("*")
        .eq("therapist_id", user.id);

      if (sortBy === "recent") query = query.order("created_at", { ascending: false });
      else if (sortBy === "highest") query = query.order("rating", { ascending: false });
      else query = query.order("rating", { ascending: true });

      const { data } = await query.limit(100);
      if (cancelled) return;

      const reviewList = data || [];
      setReviews(reviewList);
      setTotalReviews(reviewList.length);

      if (reviewList.length > 0) {
        const sum = reviewList.reduce((a, r) => a + r.rating, 0);
        setAvgRating(sum / reviewList.length);

        const dist = [0, 0, 0, 0, 0];
        reviewList.forEach((r) => { dist[r.rating - 1]++; });
        setRatingDistribution(dist);
      } else {
        setAvgRating(0);
        setRatingDistribution([0, 0, 0, 0, 0]);
      }

      setLoading(false);
    }

    void loadReviews();

    return () => {
      cancelled = true;
    };
  }, [sortBy]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setReferenceNow(Date.now());
    }, 60000);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  async function submitReply(reviewId: string) {
    if (!replyText.trim()) return;
    setSendingReply(true);
    setReplyError(null);

    // The earlier implementation awaited the UPDATE but ignored the
    // result, then unconditionally mutated local state. That created
    // phantom replies in the UI on RLS / network failure (the user
    // saw their reply, refreshed, and it was gone). Fix:
    //
    //  1. Add `.is("therapist_reply", null)` to the WHERE clause so
    //     the UPDATE only succeeds the FIRST time — never overwrites
    //     an existing reply. Defence-in-depth even with the
    //     `protect_review_columns` DB trigger; the trigger should
    //     enforce the same invariant but we don't want to depend on
    //     it being present in every environment.
    //
    //  2. `.select().maybeSingle()` returns the row when the WHERE
    //     matched. NULL means: either the row doesn't exist (RLS
    //     hides it) or the reply was already set. Both cases must
    //     show an error and NOT mutate local state.
    //
    //  3. Surface a separate `replyError` so the user knows the reply
    //     didn't land. Resetting `replyText` only on success.
    const submittedReply = replyText.trim();
    const now = new Date().toISOString();

    const supabase = createClient();
    const { data, error } = await supabase
      .from("reviews")
      .update({
        therapist_reply: submittedReply,
        therapist_reply_date: now,
      })
      .eq("id", reviewId)
      .is("therapist_reply", null)
      .select("id")
      .maybeSingle();

    setSendingReply(false);

    if (error) {
      console.error("[reviews] reply update failed:", error);
      setReplyError(t.reviews.replyErrorRetry ?? "Errore durante l'invio. Riprova.");
      return;
    }
    if (!data) {
      // Row didn't match — either RLS hid it or the reply was already
      // set (manual SQL, second submit, etc.). Refuse to mutate local
      // state and prompt the user to refresh.
      setReplyError(
        t.reviews.replyErrorAlreadyReplied ??
          "Questa recensione ha già una risposta. Aggiorna la pagina.",
      );
      return;
    }

    setReplyingTo(null);
    setReplyText("");
    setReviews((prev) =>
      prev.map((review) =>
        review.id === reviewId
          ? {
              ...review,
              therapist_reply: submittedReply,
              therapist_reply_date: now,
            }
          : review
      )
    );
  }

  function timeAgo(dateStr: string): string {
    const diff = referenceNow - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}${t.reviews.timeAgo.minutesAgo}`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}${t.reviews.timeAgo.hoursAgo}`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}${t.reviews.timeAgo.daysAgo}`;
    const months = Math.floor(days / 30);
    return `${months} ${months === 1 ? t.reviews.timeAgo.monthAgo : t.reviews.timeAgo.monthsAgo}`;
  }

  if (loading) {
    return (
      <LoadingContainer>
        <Spinner />
      </LoadingContainer>
    );
  }

  const recentReviewsCount = reviews.filter(
    (review) => referenceNow - new Date(review.created_at).getTime() < 30 * 86400000
  ).length;

  return (
    <div className="space-y-8">
      <div className="animate-reveal">
        <DisplayHeading>{t.reviews.title}</DisplayHeading>
        <p className="mt-1 text-sm text-charcoal-muted">{t.reviews.subtitle}</p>
      </div>

      {/* Stats overview */}
      {totalReviews > 0 && (
        <div className="animate-reveal grid grid-cols-1 gap-4 sm:grid-cols-2" style={{ animationDelay: "40ms" }}>
          {/* Rating summary */}
          <Card>
            <div className="flex items-center gap-4">
              <div className="text-center">
                <p className="font-[family-name:var(--font-display)] text-4xl font-bold text-charcoal">
                  {avgRating.toFixed(1)}
                </p>
                <Stars rating={Math.round(avgRating)} size="lg" />
                <p className="mt-1 text-xs text-charcoal-muted">{totalReviews} {totalReviews === 1 ? t.reviews.review : t.reviews.reviewPlural}</p>
              </div>
              <div className="flex-1 space-y-1.5">
                {[5, 4, 3, 2, 1].map((star) => {
                  const count = ratingDistribution[star - 1];
                  const pct = totalReviews > 0 ? (count / totalReviews) * 100 : 0;
                  return (
                    <div key={star} className="flex items-center gap-2">
                      <span className="w-3 text-[10px] font-semibold text-charcoal-muted text-right">{star}</span>
                      <Star className="h-3 w-3 text-gold fill-gold" />
                      <div className="flex-1 h-2 rounded-full bg-charcoal-muted/10 overflow-hidden">
                        <div className="h-full rounded-full bg-gold transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="w-6 text-[10px] text-charcoal-muted text-right">{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </Card>

          {/* Quick stats */}
          <Card>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-semibold text-charcoal-muted">{t.reviews.withReply}</p>
                <p className="mt-1 font-[family-name:var(--font-display)] text-2xl font-bold text-charcoal">
                  {reviews.filter((r) => r.therapist_reply).length}
                </p>
                <p className="text-[10px] text-charcoal-muted">
                  {totalReviews > 0
                    ? `${Math.round((reviews.filter((r) => r.therapist_reply).length / totalReviews) * 100)}% ${t.reviews.responseRate}`
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold text-charcoal-muted">{t.reviews.withoutReply}</p>
                <p className="mt-1 font-[family-name:var(--font-display)] text-2xl font-bold text-berry">
                  {reviews.filter((r) => !r.therapist_reply).length}
                </p>
                <p className="text-[10px] text-charcoal-muted">{t.reviews.awaitingReply}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-charcoal-muted">{t.reviews.fiveStarRating}</p>
                <p className="mt-1 font-[family-name:var(--font-display)] text-2xl font-bold text-success">
                  {ratingDistribution[4]}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold text-charcoal-muted">{t.reviews.lastMonth}</p>
                <p className="mt-1 font-[family-name:var(--font-display)] text-2xl font-bold text-charcoal">
                  {recentReviewsCount}
                </p>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Sort */}
      {totalReviews > 0 && (
        <div className="animate-reveal flex items-center gap-2" style={{ animationDelay: "80ms" }}>
          <span className="text-xs font-medium text-charcoal-muted">{t.reviews.sortBy}</span>
          {([
            { value: "recent" as const, label: t.reviews.sortRecent },
            { value: "highest" as const, label: t.reviews.sortHighest },
            { value: "lowest" as const, label: t.reviews.sortLowest },
          ]).map((opt) => (
            <button
              key={opt.value}
              onClick={() => setSortBy(opt.value)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-all ${
                sortBy === opt.value
                  ? "bg-berry text-white"
                  : "border border-berry/10 bg-white/70 text-charcoal-light hover:bg-berry-subtle/50"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {/* Reviews list */}
      {reviews.length === 0 ? (
        <div className="animate-reveal rounded-2xl border border-berry/5 bg-white/50 p-12 text-center" style={{ animationDelay: "80ms" }}>
          <Star className="mx-auto h-12 w-12 text-berry-muted/40" strokeWidth={1} />
          <p className="mt-4 font-medium text-charcoal-muted">{t.reviews.noReviews}</p>
          <p className="mt-1 text-sm text-charcoal-muted/70">{t.reviews.noReviewsDesc}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {reviews.map((review, i) => (
            <div
              key={review.id}
              className="animate-reveal rounded-2xl border border-berry/5 bg-white/70 p-5 shadow-sm backdrop-blur-sm transition-all hover:shadow-md"
              style={{ animationDelay: `${120 + i * 40}ms` }}
            >
              {/* Header */}
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-berry-subtle text-berry font-semibold text-sm">
                  {review.client_name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-charcoal">{review.client_name}</p>
                    <span className="text-[10px] text-charcoal-muted">{timeAgo(review.created_at)}</span>
                  </div>
                  <Stars rating={review.rating} />
                </div>
                {!review.therapist_reply && (
                  <span className="rounded-full bg-berry-subtle px-2 py-0.5 text-[10px] font-semibold text-berry">
                    {t.reviews.new}
                  </span>
                )}
              </div>

              {/* Review text */}
              {review.text && (
                <p className="mt-3 text-sm text-charcoal leading-relaxed">{review.text}</p>
              )}

              {/* Therapist reply */}
              {review.therapist_reply && (
                <div className="mt-4 ml-6 rounded-xl border-l-2 border-berry/20 bg-berry-subtle/30 px-4 py-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <MessageCircle className="h-3 w-3 text-berry" />
                    <span className="text-[10px] font-semibold text-berry">{t.reviews.yourReply}</span>
                    {review.therapist_reply_date && (
                      <span className="text-[10px] text-charcoal-muted">
                        &middot; {timeAgo(review.therapist_reply_date)}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-charcoal">{review.therapist_reply}</p>
                </div>
              )}

              {/* Reply form */}
              {replyingTo === review.id ? (
                <div className="mt-4 ml-6">
                  <textarea
                    value={replyText}
                    onChange={(e) => { setReplyText(e.target.value); if (replyError) setReplyError(null); }}
                    rows={3}
                    placeholder={t.reviews.replyPlaceholder}
                    className="w-full rounded-xl border border-berry/10 bg-white/70 px-4 py-2.5 text-sm text-charcoal placeholder:text-charcoal-muted/40 outline-none focus:border-berry/30 focus:ring-2 focus:ring-berry/10 transition-all resize-none"
                    autoFocus
                  />
                  {replyError && (
                    <p className="mt-2 text-xs text-error" role="alert">
                      {replyError}
                    </p>
                  )}
                  <div className="mt-2 flex items-center gap-2 justify-end">
                    <button
                      onClick={() => { setReplyingTo(null); setReplyText(""); setReplyError(null); }}
                      className="rounded-lg px-3 py-1.5 text-xs font-medium text-charcoal-muted hover:bg-charcoal/5"
                    >
                      {t.common.cancel}
                    </button>
                    <button
                      onClick={() => submitReply(review.id)}
                      disabled={sendingReply || !replyText.trim()}
                      className="flex items-center gap-1.5 rounded-full bg-berry px-4 py-1.5 text-xs font-semibold text-white shadow-md shadow-berry/15 disabled:opacity-50"
                    >
                      <Send className="h-3 w-3" />
                      {t.reviews.sendReply}
                    </button>
                  </div>
                </div>
              ) : !review.therapist_reply ? (
                <div className="mt-3 flex items-center gap-2">
                  <button
                    onClick={() => { setReplyingTo(review.id); setReplyText(""); }}
                    className="flex items-center gap-1.5 rounded-full border border-berry/20 px-3.5 py-1.5 text-xs font-medium text-berry hover:bg-berry-subtle/50 transition-all"
                  >
                    <MessageCircle className="h-3 w-3" />
                    {t.reviews.reply}
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
