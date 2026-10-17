import { SetMetadata } from '@nestjs/common';

export const RESPONSE_MESSAGE_KEY = 'response_message';
export const RAW_RESPONSE_KEY = 'raw_response';

/** Thông điệp đặt vào trường `message` của khung response { statusCode, message, data } */
export const ResponseMessage = (message: string) =>
  SetMetadata(RESPONSE_MESSAGE_KEY, message);

/**
 * Trả nguyên kết quả, không bọc khung response.
 * Dùng cho webhook bên thứ ba yêu cầu định dạng riêng (VD: VNPay IPN trả { RspCode, Message }).
 */
export const RawResponse = () => SetMetadata(RAW_RESPONSE_KEY, true);
