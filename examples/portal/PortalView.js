define(['text!portal/PortalView.html'], function(listViewTemplate) {

    var IndexView = Piece.View.extend({

        id: 'flightstatus-list',

        type: 'portal',

        events: {
            "click #querymore": "queryMore",
            "click #refresh": "reload",
            'click body': 'sayHello'
        },

        bindings: {
            "Segment:change io": "onIOChange",
            "List:select flightstatus-list": "onItemSelect"
        },
        sayHello: function() {
            alert("hello");
        },

        render: function() {

            $(this.el).html(listViewTemplate);

            Piece.View.prototype.render.call(this);

            this.component('io').triggerChange();

            return this;
        },
        
        onShow: function() {
            // alert("..");
            $("body").click(function(){
                alert("=.=");
            });
        },

        onItemSelect: function(list, data) {
            this.navigate('detailView', {
                trigger: true
            });
        },

        onGotResult: function(params) {
            alert(params);
        },

        onIOChange: function(comp) {
            var io = comp.getValue();
            console.info("=.=");
        },

        queryMore: function() {
            console.info(this.container);
            this.container.navigateForResult('/examples/selectView', {
                trigger: true
            }, '/examples/listView', this.onGotResult);
        },

        reload: function() {
            console.info(this.container);
            this.container.navigateForResult('/examples/demoIndex', {
                trigger: true
            }, '/examples/dialog', this.onGotResult);
        }
    });

    return IndexView;
});