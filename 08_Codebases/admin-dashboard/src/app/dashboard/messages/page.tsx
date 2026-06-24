import StreamChatProvider from "./stream-provider";
import { DisplayHeading } from "@/components/ui/DisplayHeading";

export default function MessagesPage() {
  return (
    <div>
      <DisplayHeading>
        Messages
      </DisplayHeading>
      <p className="mt-1 text-sm text-charcoal-muted">
        Chat with therapists directly from here
      </p>
      <div className="mt-6">
        <StreamChatProvider />
      </div>
    </div>
  );
}
