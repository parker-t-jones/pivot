import UIKit
import UserNotifications

/// Notification Service Extension: draws Pivot's team badge (team color plus initials, the same look
/// as the app's `TeamBadge`) and attaches it to the notification. No logos, no network, no bundled
/// color table: the server resolves fill, border and ink and sends them under `data.pivot_badge`
/// (see `shared/src/push/teamBadge.ts`).
///
/// Every failure path hands back the unmodified content, so the user gets today's plain notification.
final class NotificationService: UNNotificationServiceExtension {
  private var contentHandler: ((UNNotificationContent) -> Void)?
  private var bestAttempt: UNMutableNotificationContent?

  override func didReceive(
    _ request: UNNotificationRequest,
    withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
  ) {
    self.contentHandler = contentHandler
    guard let content = request.content.mutableCopy() as? UNMutableNotificationContent else {
      finish(request.content)
      return
    }
    bestAttempt = content
    if let badge = Badge.find(in: content.userInfo), let attachment = Self.attachment(for: badge) {
      content.attachments = [attachment]
    }
    finish(content)
  }

  override func serviceExtensionTimeWillExpire() {
    if let bestAttempt { finish(bestAttempt) }
  }

  /// Calls the system handler at most once.
  private func finish(_ content: UNNotificationContent) {
    guard let handler = contentHandler else { return }
    contentHandler = nil
    handler(content)
  }

  private static func attachment(for badge: Badge) -> UNNotificationAttachment? {
    guard let png = render(badge) else { return nil }
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(
      "pivot-badge-\(UUID().uuidString).png")
    do {
      try png.write(to: url)
      return try UNNotificationAttachment(
        identifier: "pivot-team-badge",
        url: url,
        options: [UNNotificationAttachmentOptionsTypeHintKey: "public.png"]
      )
    } catch {
      return nil
    }
  }

  /// A circle in the border color, a smaller circle in the fill color, and the initials in the ink
  /// color on top. 256 px square on a transparent background.
  private static func render(_ badge: Badge) -> Data? {
    let side: CGFloat = 256
    let ring: CGFloat = 12
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    format.opaque = false
    let renderer = UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: format)
    let image = renderer.image { context in
      let cg = context.cgContext
      let outer = CGRect(x: 0, y: 0, width: side, height: side)
      cg.setFillColor(badge.border.cgColor)
      cg.fillEllipse(in: outer)
      cg.setFillColor(badge.fill.cgColor)
      cg.fillEllipse(in: outer.insetBy(dx: ring, dy: ring))

      let fontSize: CGFloat = badge.initials.count > 2 ? 84 : 104
      let text = NSAttributedString(
        string: badge.initials,
        attributes: [
          .font: UIFont.systemFont(ofSize: fontSize, weight: .heavy),
          .foregroundColor: badge.ink,
        ]
      )
      let size = text.size()
      text.draw(at: CGPoint(x: (side - size.width) / 2, y: (side - size.height) / 2))
    }
    return image.pngData()
  }
}

/// The `pivot_badge` object from the push payload.
private struct Badge {
  let initials: String
  let fill: UIColor
  let border: UIColor
  let ink: UIColor

  static let key = "pivot_badge"

  /// Expo delivers the message `data` under `userInfo["body"]` (a dictionary, or a JSON string on
  /// some paths). Falls back to the top level of `userInfo`.
  static func find(in userInfo: [AnyHashable: Any]) -> Badge? {
    var roots: [[String: Any]] = []
    if let body = userInfo["body"] as? [String: Any] {
      roots.append(body)
    } else if let text = userInfo["body"] as? String,
      let data = text.data(using: .utf8),
      let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    {
      roots.append(object)
    }
    if let top = userInfo as? [String: Any] { roots.append(top) }
    for root in roots {
      if let raw = root[key] as? [String: Any], let badge = Badge(raw) { return badge }
    }
    return nil
  }

  init?(_ raw: [String: Any]) {
    guard
      let initials = raw["initials"] as? String, !initials.isEmpty,
      let fill = Badge.color(raw["fill"]),
      let border = Badge.color(raw["border"]),
      let ink = Badge.color(raw["ink"])
    else { return nil }
    self.initials = initials
    self.fill = fill
    self.border = border
    self.ink = ink
  }

  /// `#RRGGBB` only. Anything else makes the whole badge invalid, so the notification stays plain.
  private static func color(_ value: Any?) -> UIColor? {
    guard let text = value as? String, text.hasPrefix("#"), text.count == 7,
      let rgb = UInt32(text.dropFirst(), radix: 16)
    else { return nil }
    return UIColor(
      red: CGFloat((rgb >> 16) & 0xFF) / 255,
      green: CGFloat((rgb >> 8) & 0xFF) / 255,
      blue: CGFloat(rgb & 0xFF) / 255,
      alpha: 1
    )
  }
}
