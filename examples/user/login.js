define(['text!user/login.html'],
	function(viewTemplate) {

		return Piece.View.extend({

			id: 'login_login',

			render: function() {
				$(this.el).html(viewTemplate);

				Piece.View.prototype.render.call(this);
				return this;
			},
			onShow: function() {
				//write your business logic here 
			}
		}); //view define

	});